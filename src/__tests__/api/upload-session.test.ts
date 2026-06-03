/**
 * @jest-environment node
 */
import { POST } from '@/app/api/upload-session/route';
import { NextRequest } from 'next/server';

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
});
