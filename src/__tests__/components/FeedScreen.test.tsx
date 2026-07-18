import { render, screen, waitFor } from '@testing-library/react';
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
});
