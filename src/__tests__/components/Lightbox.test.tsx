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
});
