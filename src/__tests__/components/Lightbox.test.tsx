import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Lightbox } from '@/components/Lightbox';
import { GalleryFile } from '@/types';

const files: GalleryFile[] = [
  {
    id: 'file-1',
    mimeType: 'image/jpeg',
    thumbnailLink: 'https://lh3.googleusercontent.com/thumb-1=s220',
    viewUrl: 'https://drive.google.com/uc?id=file-1&export=download',
    createdTime: '2026-07-17T20:00:00Z',
  },
  {
    id: 'file-2',
    mimeType: 'video/quicktime',
    thumbnailLink: null,
    viewUrl: 'https://drive.google.com/uc?id=file-2&export=download',
    createdTime: '2026-07-17T20:05:00Z',
  },
];

// jsdom can't decode media, so canPlayType always returns ''. Default to a
// browser (like iOS Safari) that can play the file natively.
let canPlayTypeSpy: jest.SpyInstance;
// A decode-style error (code 4) makes the Lightbox probe /api/video before deciding
// whether the format or the server is at fault. Default: the server is healthy.
const originalFetch = global.fetch;
let fetchMock: jest.Mock;
beforeEach(() => {
  canPlayTypeSpy = jest.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
  fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 206 });
  global.fetch = fetchMock;
});
afterEach(() => {
  canPlayTypeSpy.mockRestore();
  global.fetch = originalFetch;
});

const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;
const MEDIA_ERR_SRC_NOT_SUPPORTED = 4;

// jsdom never sets HTMLMediaElement.error, so stub it before firing the event.
function failVideo(code: number) {
  const video = document.querySelector('video');
  if (!video) throw new Error('no <video> rendered');
  Object.defineProperty(video, 'error', { configurable: true, value: { code } });
  fireEvent.error(video);
}

// A passing probe first remounts the native player once; wait for that fresh <video>.
async function failAndAwaitNativeRetry(code: number): Promise<HTMLVideoElement> {
  const before = document.querySelector('video');
  failVideo(code);
  let after: HTMLVideoElement | null = null;
  await waitFor(() => {
    after = document.querySelector('video');
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
  });
  if (!after) throw new Error('no <video> after retry');
  return after;
}

describe('Lightbox', () => {
  it('renders the photo at startIndex using an enlarged thumbnail', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    expect(screen.getByRole('img', { name: 'Shot' })).toHaveAttribute(
      'src',
      'https://lh3.googleusercontent.com/thumb-1=s1600'
    );
  });

  it('advances to the next file on next tap, rendering the video from our own stream', async () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    await userEvent.click(screen.getByLabelText('Next'));
    expect(document.querySelector('video')).toHaveAttribute('src', '/api/video?id=file-2');
  });

  it('plays video in a native player with only the browser controls (no Drive iframe)', () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    const video = document.querySelector('video');
    expect(video).toHaveAttribute('controls');
    expect(video).toHaveAttribute('playsinline');
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });

  it('uses the enlarged thumbnail as the video poster when there is one', () => {
    const withThumb = [{ ...files[1], thumbnailLink: 'https://lh3.googleusercontent.com/thumb-2=s220' }];
    render(<Lightbox files={withThumb} startIndex={0} onClose={jest.fn()} />);
    expect(document.querySelector('video')).toHaveAttribute(
      'poster',
      'https://lh3.googleusercontent.com/thumb-2=s1600'
    );
  });

  it('falls back to the Drive player when the browser cannot play the format', () => {
    canPlayTypeSpy.mockReturnValue('');
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    expect(document.querySelector('video')).not.toBeInTheDocument();
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://drive.google.com/file/d/file-2/preview'
    );
  });

  it('retries the native player once when a decode failure probes fine (a brief 5xx that recovered)', async () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    const retried = await failAndAwaitNativeRetry(MEDIA_ERR_SRC_NOT_SUPPORTED);

    expect(retried).toHaveAttribute('src', '/api/video?id=file-2');
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load this video/i)).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to the Drive player when the native retry also fails to decode and the server is fine', async () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    await failAndAwaitNativeRetry(MEDIA_ERR_SRC_NOT_SUPPORTED);
    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);

    expect(await screen.findByTitle('Video 2 of 2')).toHaveAttribute(
      'src',
      'https://drive.google.com/file/d/file-2/preview'
    );
    expect(document.querySelector('video')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/video?id=file-2',
      expect.objectContaining({ headers: { Range: 'bytes=0-1' } })
    );
  });

  it('does not keep auto-retrying the native player (one retry per video, then Drive)', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 206 })
      .mockResolvedValueOnce({ ok: false, status: 502 })
      .mockResolvedValue({ ok: true, status: 206 });
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    await failAndAwaitNativeRetry(MEDIA_ERR_SRC_NOT_SUPPORTED);

    // Retry fails, server blips: manual retry offered.
    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }));

    // Decode fails again and the probe passes: the auto-retry is spent, so Drive.
    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);
    expect(await screen.findByTitle('Video 2 of 2')).toHaveAttribute(
      'src',
      'https://drive.google.com/file/d/file-2/preview'
    );
    expect(document.querySelector('video')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('shows a "Checking video" status while the probe runs and clears it after', async () => {
    let resolveProbe: (value: { ok: boolean; status: number }) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise((resolve) => {
        resolveProbe = resolve;
      })
    );
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    expect(screen.queryByText(/checking video/i)).not.toBeInTheDocument();

    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);
    expect(screen.getByRole('status')).toHaveTextContent(/checking video/i);
    // Doesn't swallow taps meant for the nav buttons underneath.
    expect(screen.getByRole('status')).toHaveClass('pointer-events-none');
    expect(screen.getByLabelText('Close')).not.toBeDisabled();

    await act(async () => {
      resolveProbe({ ok: false, status: 500 });
    });
    expect(screen.queryByText(/checking video/i)).not.toBeInTheDocument();
    expect(screen.getByText(/couldn.t load this video/i)).toBeInTheDocument();
  });

  it('clears the "Checking video" status when the guest moves away mid-probe', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);
    expect(screen.getByText(/checking video/i)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Previous'));
    expect(screen.queryByText(/checking video/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Next'));
    expect(screen.queryByText(/checking video/i)).not.toBeInTheDocument();
  });

  it('treats a missing error code like a decode failure (probes, then falls back)', async () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    const failWithoutCode = () => {
      const video = document.querySelector('video')!;
      Object.defineProperty(video, 'error', { configurable: true, value: null });
      fireEvent.error(video);
    };
    failWithoutCode();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/checking video/i)).not.toBeInTheDocument());
    failWithoutCode();

    expect(await screen.findByTitle('Video 2 of 2')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('offers a retry instead of the Drive player when the probe shows a server error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);

    expect(await screen.findByText(/couldn.t load this video/i)).toBeInTheDocument();
    expect(document.querySelector('iframe')).not.toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /try again/i });
    expect(retry).toHaveAttribute('type', 'button');
    expect(retry).not.toBeDisabled();
    expect(retry).toHaveClass('min-h-11');

    // Not remembered as a Drive fallback: retrying goes back to the native player.
    await userEvent.click(retry);
    expect(document.querySelector('video')).toHaveAttribute('src', '/api/video?id=file-2');
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });

  it('offers a retry when the probe itself fails (offline / dropped Wi-Fi)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);

    expect(await screen.findByText(/couldn.t load this video/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });

  it('ignores a probe that finishes after the guest has moved to another file', async () => {
    let resolveProbe: (value: { ok: boolean; status: number }) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise((resolve) => {
        resolveProbe = resolve;
      })
    );
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);
    const signal: AbortSignal = fetchMock.mock.calls[0][1].signal;

    await userEvent.click(screen.getByLabelText('Previous'));
    expect(signal.aborted).toBe(true);

    await act(async () => {
      resolveProbe({ ok: true, status: 206 });
    });

    await userEvent.click(screen.getByLabelText('Next'));
    expect(document.querySelector('video')).toHaveAttribute('src', '/api/video?id=file-2');
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load this video/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/checking video/i)).not.toBeInTheDocument();
  });

  it('ignores a stale probe that finishes after the auto-retry has already remounted the player', async () => {
    const resolvers: Array<(value: { ok: boolean; status: number }) => void> = [];
    fetchMock.mockImplementation(
      () => new Promise((resolve) => {
        resolvers.push(resolve);
      })
    );
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);
    await act(async () => {
      resolvers[0]({ ok: true, status: 206 });
    });
    // Native player remounted; it fails again and a second probe starts.
    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);
    const secondSignal: AbortSignal = fetchMock.mock.calls[1][1].signal;
    await userEvent.click(screen.getByLabelText('Previous'));
    expect(secondSignal.aborted).toBe(true);
    await act(async () => {
      resolvers[1]({ ok: true, status: 206 });
    });

    await userEvent.click(screen.getByLabelText('Next'));
    expect(document.querySelector('video')).toHaveAttribute('src', '/api/video?id=file-2');
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });

  it('aborts an in-flight probe when the lightbox closes', () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);
    const signal: AbortSignal = fetchMock.mock.calls[0][1].signal;
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('keeps the native player and offers a retry on a network error instead of swapping to Drive', async () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    failVideo(MEDIA_ERR_NETWORK);
    expect(fetchMock).not.toHaveBeenCalled();

    expect(document.querySelector('iframe')).not.toBeInTheDocument();
    expect(screen.getByText(/couldn.t load this video/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /try again/i }));

    expect(screen.queryByText(/couldn.t load this video/i)).not.toBeInTheDocument();
    expect(document.querySelector('video')).toHaveAttribute('src', '/api/video?id=file-2');
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
  });

  it('ignores an aborted load (e.g. navigating away mid-fetch)', () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    failVideo(MEDIA_ERR_ABORTED);
    expect(document.querySelector('video')).toBeInTheDocument();
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load this video/i)).not.toBeInTheDocument();
  });

  it('remembers the Drive fallback per video when moving between several', async () => {
    const videos: GalleryFile[] = [
      { ...files[1], id: 'vid-a' },
      { ...files[1], id: 'vid-b' },
    ];
    render(<Lightbox files={videos} startIndex={0} onClose={jest.fn()} />);
    await failAndAwaitNativeRetry(MEDIA_ERR_SRC_NOT_SUPPORTED);
    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);
    await screen.findByTitle('Video 1 of 2');
    await userEvent.click(screen.getByLabelText('Next'));
    // vid-a's spent auto-retry doesn't carry over: vid-b gets its own.
    await failAndAwaitNativeRetry(MEDIA_ERR_SRC_NOT_SUPPORTED);
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
    failVideo(MEDIA_ERR_SRC_NOT_SUPPORTED);
    await screen.findByTitle('Video 2 of 2');
    await userEvent.click(screen.getByLabelText('Previous'));

    expect(document.querySelector('video')).not.toBeInTheDocument();
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://drive.google.com/file/d/vid-a/preview'
    );
  });

  it('leaves arrow keys to the video (seeking) when it has focus', () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    const video = document.querySelector('video')!;
    video.focus();
    fireEvent.keyDown(video, { key: 'ArrowLeft' });
    expect(document.querySelector('video')).toBeInTheDocument();
  });

  it('draws the prev/next buttons above the video', () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    expect(screen.getByLabelText('Previous')).toHaveClass('z-10');
  });

  it('does not treat dragging on the video (e.g. its scrubber) as a swipe', () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    const video = document.querySelector('video')!;

    fireEvent.touchStart(video, { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchEnd(video, { changedTouches: [{ clientX: 300, clientY: 200 }] });

    expect(document.querySelector('video')).toBeInTheDocument();
  });

  it('calls onClose when the close button is tapped', async () => {
    const onClose = jest.fn();
    render(<Lightbox files={files} startIndex={0} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('hides the prev button on the first file', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    expect(screen.queryByLabelText('Previous')).not.toBeInTheDocument();
  });

  it('hides the next button on the last file', () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    expect(screen.queryByLabelText('Next')).not.toBeInTheDocument();
  });

  it('shows a friendly message instead of a broken image when the photo fails to load', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    fireEvent.error(screen.getByRole('img', { name: 'Shot' }));

    expect(screen.getByText(/couldn't load this photo/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('shows a friendly message when a photo has no thumbnail at all', () => {
    const noThumbFiles: GalleryFile[] = [{ ...files[0], thumbnailLink: null }];
    render(<Lightbox files={noThumbFiles} startIndex={0} onClose={jest.fn()} />);

    expect(screen.getByText(/couldn't load this photo/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('is exposed as a modal dialog', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('gives the close button type="button"', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    expect(screen.getByLabelText('Close')).toHaveAttribute('type', 'button');
  });

  it('closes on Escape', async () => {
    const onClose = jest.fn();
    render(<Lightbox files={files} startIndex={0} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('navigates with the arrow keys', async () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);

    await userEvent.keyboard('{ArrowRight}');
    expect(document.querySelector('video')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowLeft}');
    expect(document.querySelector('video')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Shot' })).toBeInTheDocument();
  });

  it('navigates with left/right swipes', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    const dialog = screen.getByRole('dialog');

    fireEvent.touchStart(dialog, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 100, clientY: 210 }] });
    expect(document.querySelector('video')).toBeInTheDocument();

    fireEvent.touchStart(dialog, { touches: [{ clientX: 100, clientY: 200 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 300, clientY: 190 }] });
    expect(screen.getByRole('img', { name: 'Shot' })).toBeInTheDocument();
  });

  it('ignores small touch movements (taps)', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    const dialog = screen.getByRole('dialog');

    fireEvent.touchStart(dialog, { touches: [{ clientX: 200, clientY: 200 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 180, clientY: 200 }] });
    expect(screen.getByRole('img', { name: 'Shot' })).toBeInTheDocument();
  });

  it('locks body scroll while open and restores it on close', () => {
    document.body.style.overflow = 'auto';
    const { unmount } = render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    expect(document.body.style.overflow).toBe('hidden');

    unmount();
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });

  it('labels the video for screen readers', () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    expect(document.querySelector('video')).toHaveAttribute('aria-label', 'Video 2 of 2');
  });

  it('titles the fallback Drive iframe for screen readers', () => {
    canPlayTypeSpy.mockReturnValue('');
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    expect(document.querySelector('iframe')).toHaveAttribute('title', 'Video 2 of 2');
  });

  it('moves focus to the close button on open', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    expect(screen.getByLabelText('Close')).toHaveFocus();
  });

  it('restores focus to the previously focused element on close', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    expect(opener).not.toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('keeps Tab focus inside the dialog', async () => {
    const outside = document.createElement('button');
    outside.textContent = 'outside';
    document.body.appendChild(outside);
    try {
      render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
      const close = screen.getByLabelText('Close');
      const next = screen.getByLabelText('Next');
      expect(close).toHaveFocus();

      await userEvent.tab();
      expect(next).toHaveFocus();
      await userEvent.tab();
      expect(close).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(next).toHaveFocus();
    } finally {
      outside.remove();
    }
  });

  it('positions the close button with a plain offset (no safe-area env without viewport-fit)', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    const close = screen.getByLabelText('Close');
    expect(close).toHaveClass('top-4', 'right-4');
    expect(close.className).not.toMatch(/safe-area/);
  });
});
