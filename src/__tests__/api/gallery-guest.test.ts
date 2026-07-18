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

  it('returns 500 when listGuestFiles throws', async () => {
    mockListGuestFiles.mockRejectedValue(new Error('Drive error'));

    const res = await GET(makeRequest('?guestName=Cyriel'));

    expect(res.status).toBe(500);
  });
});
