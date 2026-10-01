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
// upsized thumbnail instead.
//
// Video plays in a native <video> loaded straight from the Drive API (`alt=media`),
// which sends CORS headers, no CORP, and supports Range requests. Guest folders are
// shared "anyone with the link", so a public, referrer-restricted API key is enough.
// We don't proxy through our own API: Vercel's response cap made playback stall.
// Without a key, if the browser can't play the type, or if playback errors, we fall
// back to Google's embeddable Drive player iframe.
function largeThumbnail(url: string): string {
  return url.replace(/=s\d+$/, '=s1600');
}

function driveMediaUrl(fileId: string, apiKey: string): string {
  return `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${encodeURIComponent(apiKey)}`;
}

// Safe to call during render: the Lightbox only mounts after a tap (never in the
// server-rendered HTML), so this can't cause a hydration mismatch.
function canPlayNatively(mimeType: string): boolean {
  if (typeof document === 'undefined') return false;
  return document.createElement('video').canPlayType(mimeType) !== '';
}

const FOCUSABLE =
  'button:not([disabled]), [href], iframe, video[controls], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Minimum horizontal travel (px) before a touch counts as a swipe rather than a tap.
const SWIPE_THRESHOLD = 50;

export function Lightbox({ files, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(startIndex);
  const [erroredId, setErroredId] = useState<string | null>(null);
  const [failedVideoIds, setFailedVideoIds] = useState<ReadonlySet<string>>(() => new Set());
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const file = files[index];
  const lastIndex = files.length - 1;

  const goNext = () => setIndex((i) => Math.min(i + 1, lastIndex));
  const goPrev = () => setIndex((i) => Math.max(i - 1, 0));

  // Modal focus: move focus in on open, hand it back to whatever opened us on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();
    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  // If focus escapes the dialog anyway (e.g. tabbing out of the Drive iframe, whose
  // key events never reach this window), pull it back to the close button.
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const dialog = dialogRef.current;
      if (dialog && e.target instanceof Node && !dialog.contains(e.target)) {
        closeButtonRef.current?.focus();
      }
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, []);

  useEffect(() => {
    const trapTab = (e: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (!first || !last) {
        e.preventDefault();
        return;
      }
      const active = document.activeElement;
      const outside = !(active instanceof Node) || !dialog.contains(active);
      if (e.shiftKey && (active === first || outside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || outside)) {
        e.preventDefault();
        first.focus();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab') trapTab(e);
      else if (e.key === 'Escape') onClose();
      // A focused <video> uses the arrow keys to seek; don't also change slides.
      else if (document.activeElement instanceof HTMLVideoElement) return;
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
    // Drags that start anywhere on the video element are left to its native controls,
    // including the letterbox inside its fixed box: iOS draws the control bar over the
    // element box, so it can sit in that letterbox. Drags that start on the dialog's
    // black area outside the box still navigate.
    if (e.target instanceof Element && e.target.closest('video')) {
      touchStartRef.current = null;
      return;
    }
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
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
  const useNativeVideo =
    isVideo && !!apiKey && !failedVideoIds.has(file.id) && canPlayNatively(file.mimeType);
  const label = `${isVideo ? 'Video' : 'Photo'} ${index + 1} of ${files.length}`;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center"
    >
      <button
        ref={closeButtonRef}
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute top-4 right-4 z-10 flex size-11 items-center justify-center text-white text-2xl"
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
          className="absolute left-4 z-10 size-11 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
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
          className="absolute right-4 z-10 size-11 top-1/2 -translate-y-1/2 rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white"
        >
          <ChevronRight />
        </Button>
      )}

      {useNativeVideo && apiKey ? (
        // Native controls only, always on: toggling `controls` makes iOS Safari stack
        // its own play button on top of the control bar.
        <video
          key={file.id}
          src={driveMediaUrl(file.id, apiKey)}
          controls
          playsInline
          preload="metadata"
          poster={file.thumbnailLink ? largeThumbnail(file.thumbnailLink) : undefined}
          aria-label={label}
          // Safari doesn't put <video controls> in the Tab order on its own.
          tabIndex={0}
          onError={(e) => {
            // The video is about to be swapped for the iframe; don't let focus drop to body.
            if (document.activeElement === e.currentTarget) closeButtonRef.current?.focus();
            setFailedVideoIds((prev) => new Set(prev).add(file.id));
          }}
          // Fixed box (same as the iframe fallback) so the player doesn't start at the
          // default 300x150 with cramped controls and jump once metadata arrives; fresh
          // uploads often have no poster yet. Default object-fit (contain) letterboxes.
          className="w-[90vw] h-[70vh]"
        />
      ) : isVideo ? (
        // Fallback: Drive's embeddable player. Without fullscreen permission granted
        // here, iOS Safari overlays its own native controls on top of Drive's.
        <iframe
          key={file.id}
          src={`https://drive.google.com/file/d/${encodeURIComponent(file.id)}/preview`}
          title={`Video ${index + 1} of ${files.length}`}
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
