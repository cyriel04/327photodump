'use client';

import { useEffect, useRef, useState } from 'react';
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

// Minimum horizontal travel (px) before a touch counts as a swipe rather than a tap.
const SWIPE_THRESHOLD = 50;

export function Lightbox({ files, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(startIndex);
  const [erroredId, setErroredId] = useState<string | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const file = files[index];
  const lastIndex = files.length - 1;

  const goNext = () => setIndex((i) => Math.min(i + 1, lastIndex));
  const goPrev = () => setIndex((i) => Math.max(i - 1, 0));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, lastIndex));
      else if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, lastIndex]);

  // Stop the page behind the overlay from scrolling while it's open.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  // stopPropagation: the lightbox is rendered inside swipeable parents (the feed's
  // guest switcher), which must not also react to a swipe meant for the lightbox.
  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation();
    const touch = e.touches[0];
    touchStartRef.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    e.stopPropagation();
    const start = touchStartRef.current;
    touchStartRef.current = null;
    const touch = e.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    // Only treat mostly-horizontal movement as a swipe so vertical drags don't navigate.
    if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) goNext();
    else goPrev();
  };

  if (!file) return null;
  const isVideo = file.mimeType.startsWith('video/');
  const hasErrored = erroredId === file.id;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${isVideo ? 'Video' : 'Photo'} ${index + 1} of ${files.length}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-[max(1rem,env(safe-area-inset-top))] right-4 z-10 flex size-11 items-center justify-center text-white text-2xl"
      >
        ✕
      </button>

      {index > 0 && (
        <Button
          type="button"
          onClick={goPrev}
          aria-label="Previous"
          variant="ghost"
          size="icon"
          className="absolute left-4 size-11 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
        >
          <ChevronLeft />
        </Button>
      )}
      {index < files.length - 1 && (
        <Button
          type="button"
          onClick={goNext}
          aria-label="Next"
          variant="ghost"
          size="icon"
          className="absolute right-4 size-11 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
        >
          <ChevronRight />
        </Button>
      )}

      {isVideo ? (
        // Without fullscreen permission granted here, iOS Safari overlays its own
        // native video controls on top of the Drive player's controls.
        <iframe
          key={file.id}
          src={`https://drive.google.com/file/d/${file.id}/preview`}
          allow="autoplay; fullscreen"
          allowFullScreen
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
