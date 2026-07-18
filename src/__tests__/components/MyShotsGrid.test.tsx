import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyShotsGrid } from '@/components/MyShotsGrid';

function mockFetchOnce(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  }) as jest.Mock;
}

describe('MyShotsGrid', () => {
  it('shows a loading state before files arrive', () => {
    mockFetchOnce({ files: [] });
    render(<MyShotsGrid guestName="Cyriel" />);
    expect(screen.getByText(/loading your shots/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no files', async () => {
    mockFetchOnce({ files: [] });
    render(<MyShotsGrid guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText(/no shots synced yet/i)).toBeInTheDocument());
  });

  it('shows an error state when the fetch fails', async () => {
    mockFetchOnce({ error: 'boom' }, false);
    render(<MyShotsGrid guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText(/couldn't load your shots/i)).toBeInTheDocument());
  });

  it('renders a thumbnail per file and opens the lightbox on tap', async () => {
    mockFetchOnce({
      files: [
        {
          id: 'file-1',
          mimeType: 'image/jpeg',
          thumbnailLink: 'https://thumb-1',
          viewUrl: 'https://view-1',
          createdTime: '2026-07-17T20:00:00Z',
        },
      ],
    });
    render(<MyShotsGrid guestName="Cyriel" />);

    await waitFor(() => expect(document.querySelector('img')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button'));

    expect(document.querySelector('.fixed.inset-0')).toBeInTheDocument();
  });

  it('shows a placeholder icon when thumbnailLink is missing', async () => {
    mockFetchOnce({
      files: [
        {
          id: 'file-2',
          mimeType: 'video/mp4',
          thumbnailLink: null,
          viewUrl: 'https://view-2',
          createdTime: '2026-07-17T20:00:00Z',
        },
      ],
    });
    render(<MyShotsGrid guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText('🎥')).toBeInTheDocument());
  });
});
