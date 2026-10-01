'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GalleryFile, GalleryFeedEntry } from '@/types';
import { Lightbox } from '@/components/Lightbox';
import { Thumbnail } from '@/components/Thumbnail';
import { Button } from '@/components/ui/button';
import { thumbnailLabel, ACCESS_EXPIRED_MESSAGE } from '@/lib/utils';

interface Props {
  guestName: string;
}

type FeedStatus = 'loading' | 'ready' | 'error' | 'unauthorized' | 'empty';

export function FeedScreen({ guestName }: Props) {
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [guests, setGuests] = useState<GalleryFeedEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [filesByGuest, setFilesByGuest] = useState<Record<string, GalleryFile[]>>({});
  const [failedGuests, setFailedGuests] = useState<Record<string, boolean>>({});
  // Guests whose shots are loaded, or whose request failed. Tracked in a ref so the
  // fetch effect depends only on the active guest — depending on the cache itself
  // is what caused the old infinite refetch loop on error responses.
  const settledGuestsRef = useRef<Set<string>>(new Set());
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  // Bumped by "Tap to retry" to re-run the guest fetch effect for the active guest.
  const [retryToken, setRetryToken] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/gallery/feed')
      .then((res) => {
        if (res.status === 401) return null;
        if (!res.ok) throw new Error('Failed to load feed');
        return res.json();
      })
      .then((body: { guests: GalleryFeedEntry[] } | null) => {
        if (body === null) {
          setStatus('unauthorized');
          return;
        }
        const otherGuests = body.guests.filter((g) => g.guestName !== guestName);
        setGuests(otherGuests);
        setStatus(otherGuests.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => setStatus('error'));
  }, [guestName]);

  const activeGuest = guests[activeIndex];
  const activeGuestName = activeGuest?.guestName;

  useEffect(() => {
    if (!activeGuestName || settledGuestsRef.current.has(activeGuestName)) return;
    let cancelled = false;

    fetch(`/api/gallery/guest?guestName=${encodeURIComponent(activeGuestName)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load guest shots');
        return res.json();
      })
      .then((body: { files?: GalleryFile[] }) => {
        if (cancelled) return;
        settledGuestsRef.current.add(activeGuestName);
        setFilesByGuest((prev) => ({
          ...prev,
          [activeGuestName]: Array.isArray(body.files) ? body.files : [],
        }));
      })
      .catch(() => {
        if (cancelled) return;
        settledGuestsRef.current.add(activeGuestName);
        setFailedGuests((prev) => ({ ...prev, [activeGuestName]: true }));
      });

    return () => {
      cancelled = true;
    };
  }, [activeGuestName, retryToken]);

  const retryActiveGuest = () => {
    if (!activeGuestName) return;
    settledGuestsRef.current.delete(activeGuestName);
    setFailedGuests((prev) => {
      const next = { ...prev };
      delete next[activeGuestName];
      return next;
    });
    setRetryToken((t) => t + 1);
  };

  const goNext = () => setActiveIndex((i) => Math.min(i + 1, guests.length - 1));
  const goPrev = () => setActiveIndex((i) => Math.max(i - 1, 0));

  const handleTouchStart = (e: React.TouchEvent) => setTouchStartX(e.touches[0].clientX);
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX;
    if (delta < -50) goNext();
    if (delta > 50) goPrev();
    setTouchStartX(null);
  };

  if (status === 'loading') return <p className="text-sm text-muted-foreground">Loading feed…</p>;
  if (status === 'error') return <p role="alert" className="text-sm text-destructive">Couldn&apos;t load the feed.</p>;
  if (status === 'unauthorized') return <p role="alert" className="text-sm text-destructive">{ACCESS_EXPIRED_MESSAGE}</p>;
  if (status === 'empty') return <p className="text-sm text-muted-foreground">No shots from other guests yet.</p>;

  const activeFiles = activeGuestName ? filesByGuest[activeGuestName] ?? [] : [];
  const activeFailed = activeGuestName ? failedGuests[activeGuestName] === true : false;
  const activeLoading = activeGuestName ? !filesByGuest[activeGuestName] && !activeFailed : false;

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="flex items-center justify-between mb-2">
        {activeIndex > 0 ? (
          <Button type="button" onClick={goPrev} aria-label="Previous guest" variant="ghost" size="icon" className="size-11">
            <ChevronLeft />
          </Button>
        ) : (
          <span className="size-11" aria-hidden="true" />
        )}
        <p className="font-semibold">{activeGuest?.guestName}</p>
        {activeIndex < guests.length - 1 ? (
          <Button type="button" onClick={goNext} aria-label="Next guest" variant="ghost" size="icon" className="size-11">
            <ChevronRight />
          </Button>
        ) : (
          <span className="size-11" aria-hidden="true" />
        )}
      </div>

      {activeFailed ? (
        <div className="flex flex-col items-start gap-1">
          <p role="alert" className="text-sm text-destructive">Couldn&apos;t load these shots.</p>
          <button
            type="button"
            onClick={retryActiveGuest}
            className="min-h-11 text-sm text-muted-foreground underline"
          >
            Tap to retry
          </button>
        </div>
      ) : activeLoading ? (
        <p className="text-sm text-muted-foreground">Loading shots…</p>
      ) : (
        <div className="flex gap-1 overflow-x-auto">
          {activeFiles.map((file, i) => (
            <button
              key={file.id}
              type="button"
              onClick={() => setOpenIndex(i)}
              aria-label={thumbnailLabel(file, i, activeFiles.length)}
              className="shrink-0 w-24 h-24 bg-muted overflow-hidden"
            >
              <Thumbnail file={file} className="w-full h-full" />
            </button>
          ))}
        </div>
      )}

      {openIndex !== null && (
        <Lightbox files={activeFiles} startIndex={openIndex} onClose={() => setOpenIndex(null)} />
      )}
    </div>
  );
}
