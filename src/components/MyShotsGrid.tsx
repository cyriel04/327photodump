'use client';

import { useEffect, useState } from 'react';
import { GalleryFile } from '@/types';
import { Lightbox } from '@/components/Lightbox';
import { Thumbnail } from '@/components/Thumbnail';

interface Props {
  guestName: string;
}

type Status = 'loading' | 'ready' | 'error';

export function MyShotsGrid({ guestName }: Props) {
  const [status, setStatus] = useState<Status>('loading');
  const [files, setFiles] = useState<GalleryFile[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    fetch(`/api/gallery/guest?guestName=${encodeURIComponent(guestName)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load shots');
        return res.json();
      })
      .then((body: { files: GalleryFile[] }) => {
        if (cancelled) return;
        setFiles(body.files);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [guestName]);

  if (status === 'loading') return <p className="text-sm text-muted-foreground">Loading your shots…</p>;
  if (status === 'error') return <p className="text-sm text-destructive">Couldn&apos;t load your shots.</p>;
  if (files.length === 0) return <p className="text-sm text-muted-foreground">No shots synced yet.</p>;

  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {files.map((file, i) => (
          <button key={file.id} onClick={() => setOpenIndex(i)} className="aspect-square bg-muted overflow-hidden">
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
