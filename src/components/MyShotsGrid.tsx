'use client';

import { useEffect, useState } from 'react';
import { GalleryFile } from '@/types';
import { Lightbox } from '@/components/Lightbox';
import { Thumbnail } from '@/components/Thumbnail';
import { thumbnailLabel } from '@/lib/utils';

interface Props {
  guestName: string;
}

type Result =
  | { guestName: string; status: 'ready'; files: GalleryFile[] }
  | { guestName: string; status: 'error' };

export function MyShotsGrid({ guestName }: Props) {
  // Results are tagged with the guest they belong to, so a stale result for a
  // previous name reads as "loading" without resetting state inside the effect.
  const [result, setResult] = useState<Result | null>(null);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/gallery/guest?guestName=${encodeURIComponent(guestName)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load shots');
        return res.json();
      })
      .then((body: { files: GalleryFile[] }) => {
        if (cancelled) return;
        setResult({ guestName, status: 'ready', files: body.files });
      })
      .catch(() => {
        if (!cancelled) setResult({ guestName, status: 'error' });
      });

    return () => {
      cancelled = true;
    };
  }, [guestName]);

  const current = result?.guestName === guestName ? result : null;
  const status = current?.status ?? 'loading';
  const files = current?.status === 'ready' ? current.files : [];

  if (status === 'loading') return <p className="text-sm text-muted-foreground">Loading your shots…</p>;
  if (status === 'error') return <p role="alert" className="text-sm text-destructive">Couldn&apos;t load your shots.</p>;
  if (files.length === 0) return <p className="text-sm text-muted-foreground">No shots synced yet.</p>;

  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {files.map((file, i) => (
          <button
            key={file.id}
            type="button"
            onClick={() => setOpenIndex(i)}
            aria-label={thumbnailLabel(file, i, files.length)}
            className="aspect-square bg-muted overflow-hidden"
          >
            <Thumbnail file={file} className="w-full h-full" />
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <Lightbox files={files} startIndex={openIndex} onClose={() => setOpenIndex(null)} />
      )}
    </>
  );
}
