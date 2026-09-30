/**
 * @jest-environment node
 */
import { GET } from '@/app/api/gallery/guest/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/google-drive', () => ({
  listGuestFiles: jest.fn(),
}));

import { listGuestFiles } from '@/lib/google-drive';
const mockListGuestFiles = listGuestFiles as jest.Mock;

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/gallery/guest${query}`);
}

describe('GET /api/gallery/guest', () => {
  it('returns 400 when guestName is missing', async () => {
    const res = await GET(makeRequest(''));
    expect(res.status).toBe(400);
  });

  it('returns files for the given guest', async () => {
    mockListGuestFiles.mockResolvedValue([
      {
        id: 'file-1',
        mimeType: 'image/jpeg',
        thumbnailLink: null,
        viewUrl: 'https://x',
        createdTime: '2026-07-17T20:00:00Z',
      },
    ]);

    const res = await GET(makeRequest('?guestName=Cyriel'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(mockListGuestFiles).toHaveBeenCalledWith('Cyriel');
  });

  it('returns 500 without leaking the Drive error text', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockListGuestFiles.mockRejectedValue(new Error('Drive error secret-detail'));

    const res = await GET(makeRequest('?guestName=Cyriel'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Failed to load guest files' });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('returns 400 when guestName is whitespace only', async () => {
    mockListGuestFiles.mockClear();
    const res = await GET(makeRequest('?guestName=%20%20'));
    expect(res.status).toBe(400);
    expect(mockListGuestFiles).not.toHaveBeenCalled();
  });

  it('returns 400 when guestName is over 50 chars', async () => {
    mockListGuestFiles.mockClear();
    const res = await GET(makeRequest(`?guestName=${'a'.repeat(51)}`));
    expect(res.status).toBe(400);
    expect(mockListGuestFiles).not.toHaveBeenCalled();
  });

  it('passes a trimmed name containing an apostrophe through', async () => {
    mockListGuestFiles.mockReset().mockResolvedValue([]);
    const res = await GET(makeRequest(`?guestName=${encodeURIComponent(" O'Brien ")}`));
    expect(res.status).toBe(200);
    expect(mockListGuestFiles).toHaveBeenCalledWith("O'Brien");
  });

  it('returns an empty list for an unknown guest', async () => {
    mockListGuestFiles.mockReset().mockResolvedValue([]);
    const res = await GET(makeRequest('?guestName=Stranger'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ files: [] });
  });
});
