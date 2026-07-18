'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { GalleryFile, GalleryFeedEntry } from '@/types';
import { Lightbox } from '@/components/Lightbox';
import { Thumbnail } from '@/components/Thumbnail';
import { Button } from '@/components/ui/button';

interface Props {
  guestName: string;
}

type FeedStatus = 'loading' | 'ready' | 'error' | 'empty';

export function FeedScreen({ guestName }: Props) {
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [guests, setGuests] = useState<GalleryFeedEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [filesByGuest, setFilesByGuest] = useState<Record<string, GalleryFile[]>>({});
  const [guestFilesLoading, setGuestFilesLoading] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/gallery/feed')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load feed');
        return res.json();
      })
      .then((body: { guests: GalleryFeedEntry[] }) => {
        const otherGuests = body.guests.filter((g) => g.guestName !== guestName);
        setGuests(otherGuests);
        setStatus(otherGuests.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => setStatus('error'));
  }, [guestName]);

  const activeGuest = guests[activeIndex];

  useEffect(() => {
    if (!activeGuest || filesByGuest[activeGuest.guestName]) return;

    setGuestFilesLoading(true);
    fetch(`/api/gallery/guest?guestName=${encodeURIComponent(activeGuest.guestName)}`)
      .then((res) => res.json())
      .then((body: { files: GalleryFile[] }) => {
        setFilesByGuest((prev) => ({ ...prev, [activeGuest.guestName]: body.files }));
      })
      .finally(() => setGuestFilesLoading(false));
  }, [activeGuest, filesByGuest]);

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
  if (status === 'error') return <p className="text-sm text-destructive">Couldn&apos;t load the feed.</p>;
  if (status === 'empty') return <p className="text-sm text-muted-foreground">No shots from other guests yet.</p>;

  const activeFiles = activeGuest ? filesByGuest[activeGuest.guestName] ?? [] : [];

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="flex items-center justify-between mb-2">
        {activeIndex > 0 ? (
          <Button onClick={goPrev} aria-label="Previous guest" variant="ghost" size="icon">
            <ChevronLeft />
          </Button>
        ) : (
          <span className="size-8" aria-hidden="true" />
        )}
        <p className="font-semibold">{activeGuest?.guestName}</p>
        {activeIndex < guests.length - 1 ? (
          <Button onClick={goNext} aria-label="Next guest" variant="ghost" size="icon">
            <ChevronRight />
          </Button>
        ) : (
          <span className="size-8" aria-hidden="true" />
        )}
      </div>

      {guestFilesLoading && !filesByGuest[activeGuest.guestName] ? (
        <p className="text-sm text-muted-foreground">Loading shots…</p>
      ) : (
        <div className="flex gap-1 overflow-x-auto">
          {activeFiles.map((file, i) => (
            <button
              key={file.id}
              onClick={() => setOpenIndex(i)}
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
