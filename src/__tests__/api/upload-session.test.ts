/**
 * @jest-environment node
 */
import { POST } from '@/app/api/upload-session/route';
import { NextRequest } from 'next/server';

import { findOrCreateGuestFolder, createResumableUploadSession } from '@/lib/google-drive';

jest.mock('@/lib/google-drive', () => ({
  findOrCreateGuestFolder: jest.fn().mockResolvedValue('folder-id-123'),
  createResumableUploadSession: jest
    .fn()
    .mockResolvedValue('https://upload.googleapis.com/session-url'),
}));

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/upload-session', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

const mockFindOrCreateGuestFolder = findOrCreateGuestFolder as jest.Mock;
const mockCreateResumableUploadSession = createResumableUploadSession as jest.Mock;

const valid = {
  guestName: 'Cyriel',
  fileName: 'photo-2026-06-03.jpg',
  mimeType: 'image/jpeg',
  fileSize: 2048000,
};

beforeEach(() => {
  mockFindOrCreateGuestFolder.mockClear();
  mockCreateResumableUploadSession.mockClear();
});

describe('POST /api/upload-session', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await POST(makeRequest({ guestName: 'Cyriel' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when video exceeds 100MB', async () => {
    const res = await POST(
      makeRequest({
        guestName: 'Cyriel',
        fileName: 'video.mp4',
        mimeType: 'video/mp4',
        fileSize: 101 * 1024 * 1024,
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Video too large');
  });

  it('returns 200 with uploadUrl and folderId on success', async () => {
    const res = await POST(
      makeRequest({
        guestName: 'Cyriel',
        fileName: 'photo-2026-06-03.jpg',
        mimeType: 'image/jpeg',
        fileSize: 2048000,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).toBe('https://upload.googleapis.com/session-url');
    expect(body.folderId).toBe('folder-id-123');
  });

  it('returns 200 for video within 100MB', async () => {
    const res = await POST(
      makeRequest({
        guestName: 'Cyriel',
        fileName: 'video.mp4',
        mimeType: 'video/mp4',
        fileSize: 50 * 1024 * 1024,
      })
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 (not 500) for a non-JSON body', async () => {
    const req = new NextRequest('http://localhost/api/upload-session', {
      method: 'POST',
      body: 'not json {',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for a JSON body that is not an object', async () => {
    const res = await POST(
      new NextRequest('http://localhost/api/upload-session', { method: 'POST', body: 'null' })
    );
    expect(res.status).toBe(400);
  });

  it.each([
    ['whitespace-only guestName', { guestName: '   ' }],
    ['non-string guestName', { guestName: 123 }],
    ['guestName over 50 chars', { guestName: 'a'.repeat(51) }],
    ['empty fileName', { fileName: '' }],
    ['non-string fileName', { fileName: ['x.jpg'] }],
    ['fileName over 200 chars', { fileName: 'a'.repeat(197) + '.jpg' }],
    ['non-media mimeType', { mimeType: 'application/pdf' }],
    ['html mimeType', { mimeType: 'text/html' }],
    ['non-string mimeType', { mimeType: 42 }],
    ['zero fileSize', { fileSize: 0 }],
    ['negative fileSize', { fileSize: -5 }],
    ['string fileSize', { fileSize: '2048' }],
    ['infinite fileSize', { fileSize: 1e400 }],
    ['image over 50MB', { mimeType: 'image/jpeg', fileSize: 51 * 1024 * 1024 }],
  ])('returns 400 for %s and never touches Drive', async (_label, override) => {
    const res = await POST(makeRequest({ ...valid, ...override }));
    expect(res.status).toBe(400);
    expect(mockFindOrCreateGuestFolder).not.toHaveBeenCalled();
    expect(mockCreateResumableUploadSession).not.toHaveBeenCalled();
  });

  it('accepts a guestName of exactly 50 chars and a 200-char fileName', async () => {
    const res = await POST(
      makeRequest({ ...valid, guestName: 'a'.repeat(50), fileName: 'a'.repeat(196) + '.jpg' })
    );
    expect(res.status).toBe(200);
  });

  it('accepts an image of exactly 50MB', async () => {
    const res = await POST(makeRequest({ ...valid, fileSize: 50 * 1024 * 1024 }));
    expect(res.status).toBe(200);
  });

  it('trims the guestName before looking up the folder', async () => {
    await POST(makeRequest({ ...valid, guestName: '  Cyriel  ' }));
    expect(mockFindOrCreateGuestFolder).toHaveBeenCalledWith('Cyriel');
  });

  it("accepts a guest name containing an apostrophe", async () => {
    const res = await POST(makeRequest({ ...valid, guestName: "O'Brien" }));
    expect(res.status).toBe(200);
    expect(mockFindOrCreateGuestFolder).toHaveBeenCalledWith("O'Brien");
  });

  it('forwards the Origin header to the upload session', async () => {
    const req = new NextRequest('http://localhost/api/upload-session', {
      method: 'POST',
      body: JSON.stringify(valid),
      headers: { 'Content-Type': 'application/json', Origin: 'https://photos.example' },
    });
    await POST(req);
    expect(mockCreateResumableUploadSession).toHaveBeenCalledWith(
      'folder-id-123',
      valid.fileName,
      valid.mimeType,
      valid.fileSize,
      'https://photos.example'
    );
  });

  it('returns 500 without leaking the Drive error text', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCreateResumableUploadSession.mockRejectedValueOnce(
      new Error('Drive resumable session failed (403): secret-drive-body ya29.token')
    );

    const res = await POST(makeRequest(valid));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Failed to create upload session' });
    expect(JSON.stringify(body)).not.toContain('secret-drive-body');
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
