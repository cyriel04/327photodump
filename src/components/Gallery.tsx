'use client';

import { useId, useRef, useState } from 'react';
import { MyShotsGrid } from '@/components/MyShotsGrid';
import { FeedScreen } from '@/components/FeedScreen';
import { cn } from '@/lib/utils';

interface Props {
  guestName: string;
}

type Tab = 'mine' | 'feed';

const TABS: { id: Tab; label: string }[] = [
  { id: 'mine', label: 'My Shots' },
  { id: 'feed', label: 'Feed' },
];

export function Gallery({ guestName }: Props) {
  const [tab, setTab] = useState<Tab>('mine');
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});

  const tabId = (t: Tab) => `${baseId}-tab-${t}`;
  const panelId = (t: Tab) => `${baseId}-panel-${t}`;

  // ArrowLeft / ArrowRight move selection (and focus) between tabs, wrapping at the ends.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const current = TABS.findIndex((t) => t.id === tab);
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const next = TABS[(current + step + TABS.length) % TABS.length];
    if (!next) return;
    setTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  return (
    <div className="w-full max-w-sm space-y-3">
      <div className="text-center space-y-1">
        <p className="text-4xl">🎞</p>
        <h1 className="text-xl font-bold">You&apos;re out of film!</h1>
        <p className="text-muted-foreground text-sm">Thanks for capturing your POV 🎞</p>
      </div>

      <div role="tablist" aria-label="Gallery" onKeyDown={handleKeyDown} className="flex gap-2">
        {TABS.map(({ id, label }) => {
          const selected = tab === id;
          return (
            <button
              key={id}
              ref={(el) => {
                tabRefs.current[id] = el;
              }}
              type="button"
              role="tab"
              id={tabId(id)}
              aria-selected={selected}
              // Only the visible panel exists in the DOM, so only its tab points at it.
              aria-controls={selected ? panelId(id) : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => setTab(id)}
              className={cn('min-h-11 px-2', selected ? 'font-semibold underline' : 'text-muted-foreground')}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
        {tab === 'mine' ? <MyShotsGrid guestName={guestName} /> : <FeedScreen guestName={guestName} />}
      </div>
    </div>
  );
}
