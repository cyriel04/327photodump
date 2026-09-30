'use client';

import { useState } from 'react';
import { MyShotsGrid } from '@/components/MyShotsGrid';
import { FeedScreen } from '@/components/FeedScreen';
import { cn } from '@/lib/utils';

interface Props {
  guestName: string;
}

type Tab = 'mine' | 'feed';

export function Gallery({ guestName }: Props) {
  const [tab, setTab] = useState<Tab>('mine');

  return (
    <div className="w-full max-w-sm space-y-3">
      <div className="text-center space-y-1">
        <p className="text-4xl">🎞</p>
        <h1 className="text-xl font-bold">You&apos;re out of film!</h1>
        <p className="text-muted-foreground text-sm">Thanks for capturing your POV 🎞</p>
      </div>

      <div role="tablist" aria-label="Gallery" className="flex gap-2">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'mine'}
          onClick={() => setTab('mine')}
          className={cn('min-h-11 px-2', tab === 'mine' ? 'font-semibold underline' : 'text-muted-foreground')}
        >
          My Shots
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'feed'}
          onClick={() => setTab('feed')}
          className={cn('min-h-11 px-2', tab === 'feed' ? 'font-semibold underline' : 'text-muted-foreground')}
        >
          Feed
        </button>
      </div>

      {tab === 'mine' ? <MyShotsGrid guestName={guestName} /> : <FeedScreen guestName={guestName} />}
    </div>
  );
}
