/**
 * @jest-environment node
 */
import { GET } from '@/app/api/video/route';
import { NextRequest } from 'next/server';
import { MAX_CHUNK_BYTES } from '@/app/api/_lib/range';

jest.mock('@/lib/google-drive', () => ({
  isDriveFileId: jest.requireActual('@/lib/google-drive').isDriveFileId,
  fetchGuestVideo: jest.fn(),
}));

import { fetchGuestVideo } from '@/lib/google-drive';
const mockFetchGuestVideo = fetchGuestVideo as jest.Mock;

const VIDEO_ID = 'video-id-123';
const SECRETS = ['test-client-id', 'test-client-secret', 'test-refresh-token', 'root-folder-id', 'access-token'];

function makeRequest(query: string, range?: string) {
  return new NextRequest(`http://localhost/api/video${query}`, {
    headers: range ? { range } : undefined,
  });
}

function driveResponse(body: string | null, status: number, headers: Record<string, string> = {}) {
  return { mimeType: 'video/quicktime', media: new Response(body, { status, headers }) };
}

async function expectNoSecrets(res: Response) {
  const text = await res.text();
  const headerText = JSON.stringify([...res.headers.entries()]);
  for (const secret of SECRETS) {
    expect(text).not.toContain(secret);
    expect(headerText).not.toContain(secret);
  }
}

let errSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root-folder-id';
});

afterEach(() => {
  errSpy.mockRestore();
});

describe('GET /api/video', () => {
  it('returns 400 for a missing or malformed id without calling Drive', async () => {
    expect((await GET(makeRequest(''))).status).toBe(400);
    expect((await GET(makeRequest('?id=../../etc'))).status).toBe(400);
    expect((await GET(makeRequest("?id=abc'%20or%20'x'='x"))).status).toBe(400);
    expect(mockFetchGuestVideo).not.toHaveBeenCalled();
  });

  it('returns 404 for a file that is not a guest video', async () => {
    mockFetchGuestVideo.mockResolvedValue(null);
    const res = await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=0-1'));
    expect(res.status).toBe(404);
  });

  it('returns 416 for an unsupported Range header without calling Drive', async () => {
    const res = await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=-500'));
    expect(res.status).toBe(416);
    expect(mockFetchGuestVideo).not.toHaveBeenCalled();
  });

  it('answers the iOS bytes=0-1 probe with a 206 carrying the full size', async () => {
    mockFetchGuestVideo.mockResolvedValue(
      driveResponse('ab', 206, { 'content-type': 'text/html', 'content-length': '2', 'content-range': 'bytes 0-1/5000' }),
    );

    const res = await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=0-1'));

    expect(mockFetchGuestVideo).toHaveBeenCalledWith(VIDEO_ID, 'bytes=0-1', expect.any(AbortSignal));
    expect(res.status).toBe(206);
    // Type comes from the verified Drive metadata, never Drive's response header.
    expect(res.headers.get('content-type')).toBe('video/quicktime');
    expect(res.headers.get('content-length')).toBe('2');
    expect(res.headers.get('content-range')).toBe('bytes 0-1/5000');
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('ab');
  });

  it('keeps the 206 and Content-Range when a Range request covers the whole file', async () => {
    mockFetchGuestVideo.mockResolvedValue(
      driveResponse('abcde', 206, { 'content-length': '5', 'content-range': 'bytes 0-4/5' }),
    );

    const res = await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=0-'));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 0-4/5');
    expect(await res.text()).toBe('abcde');
  });

  it('caches in the browser no longer than the server-side guest-video check', async () => {
    mockFetchGuestVideo.mockResolvedValue(driveResponse('ab', 206, { 'content-range': 'bytes 0-1/5000' }));
    const res = await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=0-1'));
    expect(res.headers.get('cache-control')).toBe('private, max-age=300');
  });

  it('returns 502 for a 206 whose Content-Range cannot be parsed', async () => {
    for (const contentRange of [null, 'bytes */5000', 'bytes 0-1/*', 'garbage']) {
      mockFetchGuestVideo.mockResolvedValue(
        driveResponse('ab', 206, contentRange ? { 'content-length': '2', 'content-range': contentRange } : { 'content-length': '2' }),
      );
      const res = await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=0-1'));
      expect(res.status).toBe(502);
      expect(res.headers.get('content-range')).toBeNull();
      await expectNoSecrets(res);
    }
  });

  it('answers an open-ended range with a capped 206 whose total is the real file size', async () => {
    const total = 50 * 1024 * 1024;
    const end = 100 + MAX_CHUNK_BYTES - 1;
    mockFetchGuestVideo.mockResolvedValue(
      driveResponse('x', 206, { 'content-length': String(MAX_CHUNK_BYTES), 'content-range': `bytes 100-${end}/${total}` }),
    );

    const res = await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=100-'));

    expect(mockFetchGuestVideo).toHaveBeenCalledWith(VIDEO_ID, `bytes=100-${end}`, expect.any(AbortSignal));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 100-${end}/${total}`);
  });

  it('answers a plain GET for a small video with a 200 and no Content-Range', async () => {
    mockFetchGuestVideo.mockResolvedValue(
      driveResponse('abcde', 206, { 'content-length': '5', 'content-range': 'bytes 0-4/5' }),
    );

    const res = await GET(makeRequest(`?id=${VIDEO_ID}`));

    expect(mockFetchGuestVideo).toHaveBeenCalledWith(VIDEO_ID, `bytes=0-${MAX_CHUNK_BYTES - 1}`, expect.any(AbortSignal));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-range')).toBeNull();
    expect(res.headers.get('content-length')).toBe('5');
    expect(await res.text()).toBe('abcde');
  });

  it('answers a plain GET for a large video with the first chunk as a 206', async () => {
    const end = MAX_CHUNK_BYTES - 1;
    mockFetchGuestVideo.mockResolvedValue(
      driveResponse('x', 206, { 'content-length': String(MAX_CHUNK_BYTES), 'content-range': `bytes 0-${end}/99999999` }),
    );

    const res = await GET(makeRequest(`?id=${VIDEO_ID}`));

    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 0-${end}/99999999`);
  });

  it('passes a small 200 through when Drive ignores the range', async () => {
    mockFetchGuestVideo.mockResolvedValue(driveResponse('abc', 200, { 'content-length': '3' }));
    const res = await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=0-1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-range')).toBeNull();
    expect(await res.text()).toBe('abc');
  });

  it('refuses to relay a 200 that could exceed the function response limit', async () => {
    mockFetchGuestVideo.mockResolvedValue(driveResponse('abc', 200, { 'content-length': String(MAX_CHUNK_BYTES + 1) }));
    expect((await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=0-1'))).status).toBe(502);

    mockFetchGuestVideo.mockResolvedValue(driveResponse('abc', 200));
    expect((await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=0-1'))).status).toBe(502);
  });

  it('passes a Drive 416 through with its Content-Range', async () => {
    mockFetchGuestVideo.mockResolvedValue(driveResponse(null, 416, { 'content-range': 'bytes */5000' }));
    const res = await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=6000-'));
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe('bytes */5000');
  });

  it('returns 502 when Drive refuses the download, without relaying its body', async () => {
    mockFetchGuestVideo.mockResolvedValue(driveResponse('denied: access-token', 403, { 'www-authenticate': 'Bearer x' }));

    const res = await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=0-1'));

    expect(res.status).toBe(502);
    expect(res.headers.get('www-authenticate')).toBeNull();
    await expectNoSecrets(res);
  });

  it('does not forward arbitrary Drive headers', async () => {
    mockFetchGuestVideo.mockResolvedValue(
      driveResponse('ab', 206, { 'content-range': 'bytes 0-1/5000', 'set-cookie': 'x=1', 'x-goog-hash': 'abc' }),
    );
    const res = await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=0-1'));
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('x-goog-hash')).toBeNull();
  });

  it('returns 500 without leaking the Drive error text', async () => {
    mockFetchGuestVideo.mockRejectedValue(new Error('invalid_grant test-refresh-token'));

    const res = await GET(makeRequest(`?id=${VIDEO_ID}`, 'bytes=0-1'));

    expect(res.status).toBe(500);
    expect(await res.clone().json()).toEqual({ error: 'Failed to load video' });
    await expectNoSecrets(res);
  });

  it('stays quiet when the player abandons the request', async () => {
    const controller = new AbortController();
    const req = new NextRequest(`http://localhost/api/video?id=${VIDEO_ID}`, {
      headers: { range: 'bytes=0-1' },
      signal: controller.signal,
    });
    mockFetchGuestVideo.mockImplementation(async () => {
      controller.abort();
      throw new DOMException('This operation was aborted', 'AbortError');
    });

    const res = await GET(req);

    expect(res.status).toBe(499);
    expect(errSpy).not.toHaveBeenCalled();
  });
});
