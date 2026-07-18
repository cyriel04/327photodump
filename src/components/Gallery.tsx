'use client';

import { useState } from 'react';
import { MyShotsGrid } from '@/components/MyShotsGrid';
import { FeedScreen } from '@/components/FeedScreen';

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

      <div className="flex gap-2">
        <button
          onClick={() => setTab('mine')}
          className={tab === 'mine' ? 'font-semibold underline' : 'text-muted-foreground'}
        >
          My Shots
        </button>
        <button
          onClick={() => setTab('feed')}
          className={tab === 'feed' ? 'font-semibold underline' : 'text-muted-foreground'}
        >
          Feed
        </button>
      </div>

      {tab === 'mine' ? <MyShotsGrid guestName={guestName} /> : <FeedScreen guestName={guestName} />}
    </div>
  );
}
