import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedScreen } from '@/components/FeedScreen';

function mockFetchSequence(responses: unknown[]) {
  let call = 0;
  global.fetch = jest.fn().mockImplementation(() => {
    const body = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  }) as jest.Mock;
}

describe('FeedScreen', () => {
  it('shows an empty state when no guests have uploaded', async () => {
    mockFetchSequence([{ guests: [] }]);
    render(<FeedScreen guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText(/no shots from other guests/i)).toBeInTheDocument());
  });

  it('excludes the current guest from the feed', async () => {
    mockFetchSequence([
      {
        guests: [
          { guestName: 'Cyriel', coverThumbnail: null, mostRecentTime: '2026-07-17T20:10:00Z' },
          { guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' },
        ],
      },
      { files: [] },
    ]);
    render(<FeedScreen guestName="Cyriel" />);

    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument());
    expect(screen.queryByText('Cyriel')).not.toBeInTheDocument();
  });

  it('shows the empty state when the only guest with shots is the viewer', async () => {
    mockFetchSequence([
      { guests: [{ guestName: 'Cyriel', coverThumbnail: null, mostRecentTime: '2026-07-17T20:10:00Z' }] },
    ]);
    render(<FeedScreen guestName="Cyriel" />);

    await waitFor(() => expect(screen.getByText(/no shots from other guests/i)).toBeInTheDocument());
  });

  it('shows the first guest and their shots after loading', async () => {
    mockFetchSequence([
      { guests: [{ guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' }] },
      {
        files: [
          {
            id: 'file-1',
            mimeType: 'image/jpeg',
            thumbnailLink: 'https://thumb-1',
            viewUrl: 'https://view-1',
            createdTime: '2026-07-17T20:00:00Z',
          },
        ],
      },
    ]);
    render(<FeedScreen guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument());
    await waitFor(() => expect(document.querySelector('img')).toBeInTheDocument());
  });

  it('advances to the next guest and lazily loads their shots', async () => {
    mockFetchSequence([
      {
        guests: [
          { guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:10:00Z' },
          { guestName: 'Mike', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' },
        ],
      },
      { files: [] },
      {
        files: [
          {
            id: 'file-2',
            mimeType: 'video/mp4',
            thumbnailLink: null,
            viewUrl: 'https://view-2',
            createdTime: '2026-07-17T20:00:00Z',
          },
        ],
      },
    ]);
    render(<FeedScreen guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText('Next guest'));

    await waitFor(() => expect(screen.getByText('Mike')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('🎥')).toBeInTheDocument());
  });

  it('hides the previous-guest button on the first guest', async () => {
    mockFetchSequence([
      { guests: [{ guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' }] },
      { files: [] },
    ]);
    render(<FeedScreen guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument());

    expect(screen.queryByLabelText('Previous guest')).not.toBeInTheDocument();
  });

  it('hides the next-guest button on the last guest', async () => {
    mockFetchSequence([
      { guests: [{ guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' }] },
      { files: [] },
    ]);
    render(<FeedScreen guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument());

    expect(screen.queryByLabelText('Next guest')).not.toBeInTheDocument();
  });

  it('opens the lightbox when a thumbnail is tapped', async () => {
    mockFetchSequence([
      { guests: [{ guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' }] },
      {
        files: [
          {
            id: 'file-1',
            mimeType: 'image/jpeg',
            thumbnailLink: 'https://thumb-1',
            viewUrl: 'https://view-1',
            createdTime: '2026-07-17T20:00:00Z',
          },
        ],
      },
    ]);
    render(<FeedScreen guestName="Cyriel" />);
    await waitFor(() => expect(document.querySelector('img')).toBeInTheDocument());

    const thumbnailButton = screen.getAllByRole('button').find((b) => b.querySelector('img'))!;
    await userEvent.click(thumbnailButton);

    expect(document.querySelector('.fixed.inset-0')).toBeInTheDocument();
  });

  it('shows an error for the strip and does not refetch in a loop when the guest request fails', async () => {
    let call = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              guests: [{ guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' }],
            }),
        });
      }
      return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'boom' }) });
    }) as jest.Mock;

    render(<FeedScreen guestName="Cyriel" />);

    expect(await screen.findByText("Couldn't load these shots.")).toBeInTheDocument();
    // Give any runaway effect a chance to fire again.
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('shows an error for the strip when the guest request has a network error', async () => {
    let call = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              guests: [{ guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' }],
            }),
        });
      }
      return Promise.reject(new TypeError('Load failed'));
    }) as jest.Mock;

    render(<FeedScreen guestName="Cyriel" />);

    expect(await screen.findByText("Couldn't load these shots.")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it("ignores a slow response for a guest the viewer has already swiped past", async () => {
    let resolveSarah: (value: unknown) => void = () => {};
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/gallery/feed') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              guests: [
                { guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:10:00Z' },
                { guestName: 'Mike', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' },
              ],
            }),
        });
      }
      if (url.includes('Sarah')) {
        return new Promise((resolve) => {
          resolveSarah = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            files: [
              {
                id: 'mike-1',
                mimeType: 'video/mp4',
                thumbnailLink: null,
                viewUrl: 'https://view-2',
                createdTime: '2026-07-17T20:00:00Z',
              },
            ],
          }),
      });
    }) as jest.Mock;

    render(<FeedScreen guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Next guest'));
    expect(await screen.findByRole('button', { name: 'Open video 1 of 1' })).toBeInTheDocument();

    await act(async () => {
      resolveSarah({
        ok: true,
        json: () =>
          Promise.resolve({
            files: [
              {
                id: 'sarah-1',
                mimeType: 'image/jpeg',
                thumbnailLink: 'https://thumb-s',
                viewUrl: 'https://view-s',
                createdTime: '2026-07-17T20:00:00Z',
              },
            ],
          }),
      });
    });

    expect(screen.getByText('Mike')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open video 1 of 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /open photo/i })).not.toBeInTheDocument();
  });

  it('gives each thumbnail a descriptive label and type="button"', async () => {
    mockFetchSequence([
      { guests: [{ guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' }] },
      {
        files: [
          { id: 'a', mimeType: 'image/jpeg', thumbnailLink: 'https://a', viewUrl: 'https://va', createdTime: '2026-07-17T20:00:00Z' },
          { id: 'b', mimeType: 'video/mp4', thumbnailLink: null, viewUrl: 'https://vb', createdTime: '2026-07-17T20:01:00Z' },
        ],
      },
    ]);
    render(<FeedScreen guestName="Cyriel" />);

    const photo = await screen.findByRole('button', { name: 'Open photo 1 of 2' });
    const video = screen.getByRole('button', { name: 'Open video 2 of 2' });
    expect(photo).toHaveAttribute('type', 'button');
    expect(video).toHaveAttribute('type', 'button');
  });

  it('does not switch guests when swiping inside the open lightbox', async () => {
    mockFetchSequence([
      {
        guests: [
          { guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:10:00Z' },
          { guestName: 'Mike', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' },
        ],
      },
      {
        files: [
          { id: 'a', mimeType: 'image/jpeg', thumbnailLink: 'https://a', viewUrl: 'https://va', createdTime: '2026-07-17T20:00:00Z' },
          { id: 'b', mimeType: 'image/jpeg', thumbnailLink: 'https://b', viewUrl: 'https://vb', createdTime: '2026-07-17T20:01:00Z' },
        ],
      },
    ]);
    render(<FeedScreen guestName="Cyriel" />);
    await userEvent.click(await screen.findByRole('button', { name: 'Open photo 1 of 2' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.touchStart(dialog, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 100, clientY: 200 }] });

    expect(screen.getByRole('dialog')).toHaveAccessibleName('Photo 2 of 2');
    expect(screen.getByText('Sarah')).toBeInTheDocument();
    expect(screen.queryByText('Mike')).not.toBeInTheDocument();
  });

  it('announces a failed feed load', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) }) as jest.Mock;
    render(<FeedScreen guestName="Cyriel" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't load the feed/i);
  });

  it('tells the guest to re-scan the QR code when the feed returns 401', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    }) as jest.Mock;
    render(<FeedScreen guestName="Cyriel" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/scan the QR code at the venue again/i);
    expect(screen.queryByText(/couldn't load the feed/i)).not.toBeInTheDocument();
  });

  it('offers a retry after a failed guest fetch and refetches that guest', async () => {
    let guestCalls = 0;
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url === '/api/gallery/feed') {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              guests: [{ guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' }],
            }),
        });
      }
      guestCalls += 1;
      if (guestCalls === 1) return Promise.reject(new TypeError('Load failed'));
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            files: [
              { id: 'a', mimeType: 'image/jpeg', thumbnailLink: 'https://a', viewUrl: 'https://va', createdTime: '2026-07-17T20:00:00Z' },
            ],
          }),
      });
    }) as jest.Mock;

    render(<FeedScreen guestName="Cyriel" />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load these shots.");

    const retry = screen.getByRole('button', { name: /tap to retry/i });
    expect(retry).toHaveAttribute('type', 'button');
    expect(retry).toHaveClass('min-h-11');

    await userEvent.click(retry);

    expect(await screen.findByRole('button', { name: 'Open photo 1 of 1' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(guestCalls).toBe(2);
  });

  it('gives the prev/next guest buttons and their spacers a 44px size', async () => {
    mockFetchSequence([
      {
        guests: [
          { guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:10:00Z' },
          { guestName: 'Mike', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' },
        ],
      },
      { files: [] },
    ]);
    const { container } = render(<FeedScreen guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument());

    expect(screen.getByLabelText('Next guest')).toHaveClass('size-11');
    expect(container.querySelector('span[aria-hidden="true"]')).toHaveClass('size-11');

    await userEvent.click(screen.getByLabelText('Next guest'));
    expect(screen.getByLabelText('Previous guest')).toHaveClass('size-11');
  });
});
