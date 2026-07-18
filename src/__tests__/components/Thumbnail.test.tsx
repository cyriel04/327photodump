import { render, screen, fireEvent } from '@testing-library/react';
import { Thumbnail } from '@/components/Thumbnail';
import { GalleryFile } from '@/types';

const photoFile: GalleryFile = {
  id: 'file-1',
  mimeType: 'image/jpeg',
  thumbnailLink: 'https://thumb-1',
  viewUrl: 'https://view-1',
  createdTime: '2026-07-17T20:00:00Z',
};

const videoFile: GalleryFile = {
  id: 'file-2',
  mimeType: 'video/mp4',
  thumbnailLink: null,
  viewUrl: 'https://view-2',
  createdTime: '2026-07-17T20:00:00Z',
};

describe('Thumbnail', () => {
  it('renders the thumbnail image when thumbnailLink is present', () => {
    render(<Thumbnail file={photoFile} />);
    expect(document.querySelector('img')).toHaveAttribute('src', 'https://thumb-1');
  });

  it('shows a placeholder icon when thumbnailLink is missing', () => {
    render(<Thumbnail file={videoFile} />);
    expect(screen.getByText('🎥')).toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });

  it('shows a placeholder icon when the image fails to load', () => {
    render(<Thumbnail file={photoFile} />);
    const img = document.querySelector('img')!;
    fireEvent.error(img);
    expect(screen.getByText('📷')).toBeInTheDocument();
    expect(document.querySelector('img')).not.toBeInTheDocument();
  });
});
