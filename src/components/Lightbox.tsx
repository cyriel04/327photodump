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
// upsized thumbnail instead. Video streams through /api/video so it can play in a
// plain <video> with the browser's own controls; Drive's player iframe is only the
// fallback for formats this browser can't decode (e.g. iPhone HEVC .mov in Firefox).
function largeThumbnail(url: string): string {
  return url.replace(/=s\d+$/, '=s1600');
}

// Called during render. Safe from hydration mismatches because the lightbox only
// mounts after a tap (FeedScreen/MyShotsGrid start with openIndex = null), so it is
// never part of the server-rendered HTML.
function canPlayNatively(mimeType: string): boolean {
  if (typeof document === 'undefined') return false;
  return document.createElement('video').canPlayType(mimeType) !== '';
}

// HTMLMediaElement.error codes (MediaError.MEDIA_ERR_*). Spelled out because jsdom
// doesn't define the MediaError global.
const MEDIA_ERR_ABORTED = 1;
const MEDIA_ERR_NETWORK = 2;

type VideoLoadError = { id: string; kind: 'network' | 'server' };

function videoSrc(id: string): string {
  return `/api/video?id=${encodeURIComponent(id)}`;
}

const FOCUSABLE =
  'button:not([disabled]), [href], iframe, video[controls], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Minimum horizontal travel (px) before a touch counts as a swipe rather than a tap.
const SWIPE_THRESHOLD = 50;

export function Lightbox({ files, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(startIndex);
  const [erroredId, setErroredId] = useState<string | null>(null);
  // Videos this browser couldn't decode natively; they use Drive's player instead.
  const [driveFallbackIds, setDriveFallbackIds] = useState<ReadonlySet<string>>(() => new Set());
  const [videoError, setVideoError] = useState<VideoLoadError | null>(null);
  // Videos whose one automatic native retry is already spent (see probeVideo).
  const [nativeRetriedIds, setNativeRetriedIds] = useState<ReadonlySet<string>>(() => new Set());
  // The in-flight /api/video probe, if any. Aborted on file change and unmount.
  const probeRef = useRef<AbortController | null>(null);
  // Drives the "Checking video…" status; cleared when its probe settles or aborts.
  const [probing, setProbing] = useState<{ id: string; controller: AbortController } | null>(null);
  // Bumped by "Try again" to remount the <video> and restart its fetch.
  const [videoAttempt, setVideoAttempt] = useState(0);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const file = files[index];
  const lastIndex = files.length - 1;

  const fileId = file?.id;
  useEffect(() => {
    return () => {
      probeRef.current?.abort();
      probeRef.current = null;
    };
  }, [fileId]);

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
      else if (e.target instanceof HTMLVideoElement) return;
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
    // Dragging the video's scrubber must not count as a swipe.
    if (e.target instanceof HTMLVideoElement) {
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
  const useDrivePlayer = isVideo && (driveFallbackIds.has(file.id) || !canPlayNatively(file.mimeType));
  const loadError = videoError?.id === file.id ? videoError.kind : null;
  const isProbing = probing?.id === file.id;

  // Browsers report an HTTP error from /api/video (500 expired token, 502 Drive rate
  // limit, 404) as SRC_NOT_SUPPORTED, same as a real decode failure. Ask the route
  // directly: if it serves bytes, either the format is the problem or the route just
  // recovered from a blip, so remount the native player once; only a second passing
  // probe for the same id sends it to Drive's player. If the route errors, it's
  // temporary: offer a retry and don't remember the id.
  const probeVideo = (id: string) => {
    probeRef.current?.abort();
    const controller = new AbortController();
    probeRef.current = controller;
    setProbing({ id, controller });
    const isCurrent = () => probeRef.current === controller && !controller.signal.aborted;
    const clearProbing = () => setProbing((p) => (p?.controller === controller ? null : p));
    controller.signal.addEventListener('abort', clearProbing);
    const alreadyRetried = nativeRetriedIds.has(id);

    fetch(videoSrc(id), { headers: { Range: 'bytes=0-1' }, cache: 'no-store', signal: controller.signal })
      .then((res) => {
        if (!isCurrent()) return;
        probeRef.current = null;
        clearProbing();
        if (!res.ok) setVideoError({ id, kind: 'server' });
        else if (alreadyRetried) setDriveFallbackIds((prev) => new Set(prev).add(id));
        else {
          setNativeRetriedIds((prev) => new Set(prev).add(id));
          setVideoAttempt((n) => n + 1);
        }
      })
      .catch(() => {
        if (!isCurrent()) return;
        probeRef.current = null;
        clearProbing();
        setVideoError({ id, kind: 'network' });
      });
  };

  // Only a format/decode failure justifies swapping to Drive's player (which brings
  // back its own controls on top of iOS Safari's). A network error on venue Wi-Fi
  // gets a retry instead, and an abort (e.g. leaving mid-load) is not a failure.
  const handleVideoError = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const code = e.currentTarget.error?.code;
    if (code === MEDIA_ERR_ABORTED) return;
    if (code === MEDIA_ERR_NETWORK) {
      setVideoError({ id: file.id, kind: 'network' });
      return;
    }
    probeVideo(file.id);
  };

  const retryVideo = () => {
    setVideoError(null);
    setVideoAttempt((n) => n + 1);
  };

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${isVideo ? 'Video' : 'Photo'} ${index + 1} of ${files.length}`}
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

      {isVideo && loadError ? (
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <p className="text-white text-sm">
            {loadError === 'server'
              ? "Couldn't load this video right now. Try again in a moment."
              : "Couldn't load this video. Check your connection."}
          </p>
          <Button type="button" onClick={retryVideo} variant="secondary" className="min-h-11">
            Try again
          </Button>
        </div>
      ) : isVideo && !useDrivePlayer ? (
        // Native controls only, always on: iOS Safari shows exactly its own set.
        <video
          key={`${file.id}-${videoAttempt}`}
          src={videoSrc(file.id)}
          poster={file.thumbnailLink ? largeThumbnail(file.thumbnailLink) : undefined}
          aria-label={`Video ${index + 1} of ${files.length}`}
          controls
          playsInline
          preload="metadata"
          onError={handleVideoError}
          className="max-h-[80vh] max-w-full"
        />
      ) : isVideo ? (
        <iframe
          key={file.id}
          src={`https://drive.google.com/file/d/${file.id}/preview`}
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

      {/* Always mounted so screen readers announce the text when it appears.
          pointer-events-none: never swallows taps meant for the controls. */}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center"
      >
        {isProbing && (
          <span className="rounded-full bg-black/70 px-3 py-1.5 text-sm text-white">Checking video…</span>
        )}
      </div>
    </div>
  );
}
