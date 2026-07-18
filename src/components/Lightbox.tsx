'use client';

import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GalleryFile } from '@/types';
import { Button } from '@/components/ui/button';

interface Props {
  files: GalleryFile[];
  startIndex: number;
  onClose: () => void;
}

// Drive's webContentLink sets Cross-Origin-Resource-Policy: same-site, which browsers
// block from loading cross-origin regardless of our own page's policy. thumbnailLink
// (lh3.googleusercontent.com) has no such restriction, so photos render from an
// upsized thumbnail instead. Video can't be hotlinked at all under that policy, so it
// uses Google's own embeddable player iframe (loses autoplay, but actually plays).
function largeThumbnail(url: string): string {
  return url.replace(/=s\d+$/, '=s1600');
}

export function Lightbox({ files, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(startIndex);
  const [erroredId, setErroredId] = useState<string | null>(null);
  const file = files[index];

  const goNext = () => setIndex((i) => Math.min(i + 1, files.length - 1));
  const goPrev = () => setIndex((i) => Math.max(i - 1, 0));

  if (!file) return null;
  const isVideo = file.mimeType.startsWith('video/');
  const hasErrored = erroredId === file.id;

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 text-white text-2xl">
        ✕
      </button>

      {index > 0 && (
        <Button
          onClick={goPrev}
          aria-label="Previous"
          variant="ghost"
          size="icon"
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
        >
          <ChevronLeft />
        </Button>
      )}
      {index < files.length - 1 && (
        <Button
          onClick={goNext}
          aria-label="Next"
          variant="ghost"
          size="icon"
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
        >
          <ChevronRight />
        </Button>
      )}

      {isVideo ? (
        <iframe
          key={file.id}
          src={`https://drive.google.com/file/d/${file.id}/preview`}
          allow="autoplay"
          className="w-[90vw] h-[70vh] border-0"
        />
      ) : hasErrored || !file.thumbnailLink ? (
        <p className="text-white text-sm">Couldn&apos;t load this photo.</p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={file.id}
          src={largeThumbnail(file.thumbnailLink)}
          alt="Shot"
          onError={() => setErroredId(file.id)}
          className="max-h-full max-w-full object-contain"
        />
      )}
    </div>
  );
}
