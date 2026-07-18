'use client';

import { useState } from 'react';
import { GalleryFile } from '@/types';

interface Props {
  file: GalleryFile;
  className?: string;
}

export function Thumbnail({ file, className = '' }: Props) {
  const [failed, setFailed] = useState(false);
  const icon = file.mimeType.startsWith('video/') ? '🎥' : '📷';

  if (failed || !file.thumbnailLink) {
    return <span className={`flex items-center justify-center text-2xl ${className}`}>{icon}</span>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={file.thumbnailLink}
      alt=""
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}
