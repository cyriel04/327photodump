import { render, screen, fireEvent } from '@testing-library/react';
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

const ORIGINAL_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
const canPlayType = jest.fn<CanPlayTypeResult, [string]>(() => 'maybe');

beforeAll(() => {
  // jsdom returns '' from canPlayType for everything; control it per test instead.
  Object.defineProperty(HTMLMediaElement.prototype, 'canPlayType', {
    configurable: true,
    value: function (this: HTMLMediaElement, type: string) {
      return canPlayType(type);
    },
  });
});

beforeEach(() => {
  // Default: no API key, so the existing tests exercise the Drive iframe fallback.
  delete process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
  canPlayType.mockReset();
  canPlayType.mockReturnValue('maybe');
});

afterAll(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
  else process.env.NEXT_PUBLIC_GOOGLE_API_KEY = ORIGINAL_KEY;
});

describe('Lightbox', () => {
  it('renders the photo at startIndex using an enlarged thumbnail', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    expect(screen.getByRole('img', { name: 'Shot' })).toHaveAttribute(
      'src',
      'https://lh3.googleusercontent.com/thumb-1=s1600'
    );
  });

  it('advances to the next file on next tap, rendering the video as a Drive embed', async () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    await userEvent.click(screen.getByLabelText('Next'));
    const iframe = document.querySelector('iframe');
    expect(iframe).toHaveAttribute('src', 'https://drive.google.com/file/d/file-2/preview');
  });

  it('renders video as a Google Drive embeddable player (no cross-origin video src)', () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    expect(document.querySelector('video')).not.toBeInTheDocument();
    expect(document.querySelector('iframe')).toHaveAttribute(
      'src',
      'https://drive.google.com/file/d/file-2/preview'
    );
  });

  it('grants the video iframe fullscreen permission so iOS Safari does not overlay native controls on top of the Drive player', () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    const iframe = document.querySelector('iframe');
    expect(iframe).toHaveAttribute('allow', 'autoplay; fullscreen');
    expect(iframe).toHaveAttribute('allowfullscreen');
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
    expect(document.querySelector('iframe')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowLeft}');
    expect(document.querySelector('iframe')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Shot' })).toBeInTheDocument();
  });

  it('navigates with left/right swipes', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    const dialog = screen.getByRole('dialog');

    fireEvent.touchStart(dialog, { touches: [{ clientX: 300, clientY: 200 }] });
    fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 100, clientY: 210 }] });
    expect(document.querySelector('iframe')).toBeInTheDocument();

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

  it('titles the video iframe for screen readers', () => {
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
  describe('native video (API key set)', () => {
    const videoFiles: GalleryFile[] = [
      files[0],
      { ...files[1], thumbnailLink: 'https://lh3.googleusercontent.com/thumb-2=s220' },
      { ...files[1], id: 'file-3' },
    ];

    beforeEach(() => {
      process.env.NEXT_PUBLIC_GOOGLE_API_KEY = 'test-key';
    });

    function videoEl() {
      return document.querySelector('video');
    }

    it('streams the video straight from googleapis with the API key and native controls only', () => {
      render(<Lightbox files={videoFiles} startIndex={1} onClose={jest.fn()} />);
      const video = videoEl();
      expect(video).toHaveAttribute(
        'src',
        'https://www.googleapis.com/drive/v3/files/file-2?alt=media&key=test-key'
      );
      expect(video).toHaveAttribute('controls');
      expect(video).toHaveAttribute('playsinline');
      expect(video).toHaveAttribute('preload', 'metadata');
      expect(video).toHaveAttribute('aria-label', 'Video 2 of 3');
      expect(document.querySelector('iframe')).not.toBeInTheDocument();
      expect(canPlayType).toHaveBeenCalledWith('video/quicktime');
    });

    it('URL-encodes the file id and key', () => {
      process.env.NEXT_PUBLIC_GOOGLE_API_KEY = 'a&b=c';
      const odd: GalleryFile[] = [{ ...files[1], id: 'x/y?z' }];
      render(<Lightbox files={odd} startIndex={0} onClose={jest.fn()} />);
      expect(videoEl()).toHaveAttribute(
        'src',
        'https://www.googleapis.com/drive/v3/files/x%2Fy%3Fz?alt=media&key=a%26b%3Dc'
      );
    });

    it('uses the enlarged thumbnail as the poster', () => {
      render(<Lightbox files={videoFiles} startIndex={1} onClose={jest.fn()} />);
      expect(videoEl()).toHaveAttribute('poster', 'https://lh3.googleusercontent.com/thumb-2=s1600');
    });

    it('omits the poster when there is no thumbnail', () => {
      render(<Lightbox files={videoFiles} startIndex={2} onClose={jest.fn()} />);
      expect(videoEl()).not.toHaveAttribute('poster');
    });

    it('falls back to the Drive iframe when there is no API key', () => {
      delete process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
      render(<Lightbox files={videoFiles} startIndex={1} onClose={jest.fn()} />);
      expect(videoEl()).not.toBeInTheDocument();
      expect(document.querySelector('iframe')).toHaveAttribute(
        'src',
        'https://drive.google.com/file/d/file-2/preview'
      );
    });

    it('falls back to the Drive iframe when the browser cannot play the type', () => {
      canPlayType.mockReturnValue('');
      render(<Lightbox files={videoFiles} startIndex={1} onClose={jest.fn()} />);
      expect(videoEl()).not.toBeInTheDocument();
      expect(document.querySelector('iframe')).toHaveAttribute(
        'src',
        'https://drive.google.com/file/d/file-2/preview'
      );
    });

    it('falls back to the Drive iframe after a playback error and remembers it for that video only', async () => {
      render(<Lightbox files={videoFiles} startIndex={1} onClose={jest.fn()} />);
      fireEvent.error(videoEl() as HTMLVideoElement);

      expect(videoEl()).not.toBeInTheDocument();
      expect(document.querySelector('iframe')).toHaveAttribute(
        'src',
        'https://drive.google.com/file/d/file-2/preview'
      );

      // Another video still tries the native player...
      await userEvent.click(screen.getByLabelText('Next'));
      expect(videoEl()).toHaveAttribute(
        'src',
        'https://www.googleapis.com/drive/v3/files/file-3?alt=media&key=test-key'
      );

      // ...and coming back to the failed one goes straight to the iframe.
      await userEvent.click(screen.getByLabelText('Previous'));
      expect(videoEl()).not.toBeInTheDocument();
      expect(document.querySelector('iframe')).toHaveAttribute(
        'src',
        'https://drive.google.com/file/d/file-2/preview'
      );
    });

    // Swipe contract for native video: any drag that starts on the <video> element is
    // left to the native controls, including the letterbox inside the element (iOS draws
    // its control bar over the element box, which can sit in that letterbox). Drags that
    // start on the black area of the dialog outside the 90vw x 70vh box still navigate.
    it('does not change slides when a horizontal drag starts on the video (scrubbing)', () => {
      render(<Lightbox files={videoFiles} startIndex={1} onClose={jest.fn()} />);
      const video = videoEl() as HTMLVideoElement;

      fireEvent.touchStart(video, { touches: [{ clientX: 300, clientY: 200 }] });
      fireEvent.touchEnd(video, { changedTouches: [{ clientX: 50, clientY: 205 }] });

      expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Video 2 of 3');
      expect(videoEl()).toHaveAttribute(
        'src',
        'https://www.googleapis.com/drive/v3/files/file-2?alt=media&key=test-key'
      );
    });

    it('still swipes when the drag starts on the dialog area outside the video box', () => {
      render(<Lightbox files={videoFiles} startIndex={1} onClose={jest.fn()} />);
      const dialog = screen.getByRole('dialog');

      fireEvent.touchStart(dialog, { touches: [{ clientX: 300, clientY: 200 }] });
      fireEvent.touchEnd(dialog, { changedTouches: [{ clientX: 50, clientY: 205 }] });

      expect(dialog).toHaveAttribute('aria-label', 'Video 3 of 3');
    });

    it('leaves arrow keys to the video while it has focus', async () => {
      render(<Lightbox files={videoFiles} startIndex={1} onClose={jest.fn()} />);
      const video = videoEl() as HTMLVideoElement;
      video.focus();
      expect(video).toHaveFocus();

      await userEvent.keyboard('{ArrowRight}');
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Video 2 of 3');
      await userEvent.keyboard('{ArrowLeft}');
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Video 2 of 3');

      // Escape still closes, and arrows work again once focus leaves the video.
      screen.getByLabelText('Close').focus();
      await userEvent.keyboard('{ArrowRight}');
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Video 3 of 3');
    });

    it('includes the video in the Tab focus trap', async () => {
      render(<Lightbox files={videoFiles} startIndex={2} onClose={jest.fn()} />);
      const close = screen.getByLabelText('Close');
      const prev = screen.getByLabelText('Previous');
      const video = videoEl() as HTMLVideoElement;
      expect(close).toHaveFocus();

      await userEvent.tab();
      expect(prev).toHaveFocus();
      await userEvent.tab();
      expect(video).toHaveFocus();
      await userEvent.tab();
      expect(close).toHaveFocus();
    });

    it('gives the video a stable box so it does not render at 300x150 or jump when metadata arrives', () => {
      // Video 3 has no poster: the case where the box matters most.
      render(<Lightbox files={videoFiles} startIndex={2} onClose={jest.fn()} />);
      const video = videoEl();
      expect(video).toHaveClass('w-[90vw]', 'h-[70vh]');
      expect(video).not.toHaveClass('max-h-full', 'max-w-full');
    });

    it('closes on Escape while the video has focus', async () => {
      const onClose = jest.fn();
      render(<Lightbox files={videoFiles} startIndex={1} onClose={onClose} />);
      const video = videoEl() as HTMLVideoElement;
      video.focus();
      expect(video).toHaveFocus();

      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalled();
    });

    it('moves focus to the close button when a focused video errors and is swapped for the iframe', () => {
      render(<Lightbox files={videoFiles} startIndex={1} onClose={jest.fn()} />);
      const video = videoEl() as HTMLVideoElement;
      video.focus();

      fireEvent.error(video);

      expect(document.querySelector('iframe')).toBeInTheDocument();
      expect(screen.getByLabelText('Close')).toHaveFocus();
    });

    it('URL-encodes the file id in the Drive iframe fallback too', () => {
      delete process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
      const odd: GalleryFile[] = [{ ...files[1], id: 'x/y?z' }];
      render(<Lightbox files={odd} startIndex={0} onClose={jest.fn()} />);
      expect(document.querySelector('iframe')).toHaveAttribute(
        'src',
        'https://drive.google.com/file/d/x%2Fy%3Fz/preview'
      );
    });

    it('keeps the prev/next buttons stacked above the video', () => {
      render(<Lightbox files={videoFiles} startIndex={1} onClose={jest.fn()} />);
      expect(screen.getByLabelText('Previous')).toHaveClass('z-10');
      expect(screen.getByLabelText('Next')).toHaveClass('z-10');
    });
  });
});
