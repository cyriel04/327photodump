/**
 * @jest-environment node
 */
import { GET } from '@/app/api/gallery/feed/route';

jest.mock('@/lib/google-drive', () => ({
  listGuestsByActivity: jest.fn(),
}));

import { listGuestsByActivity } from '@/lib/google-drive';
const mockListGuestsByActivity = listGuestsByActivity as jest.Mock;

describe('GET /api/gallery/feed', () => {
  it('returns guests from listGuestsByActivity', async () => {
    mockListGuestsByActivity.mockResolvedValue([
      { guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' },
    ]);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guests).toHaveLength(1);
  });

  it('returns 500 without leaking the Drive error text', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockListGuestsByActivity.mockRejectedValue(new Error('Drive error secret-detail'));

    const res = await GET();

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Failed to load feed' });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
