'use client';

import { useGuestSession } from '@/lib/use-guest-session';
import { NameEntry } from '@/components/NameEntry';
import { CameraCapture } from '@/components/CameraCapture';
import { OutOfFilm } from '@/components/OutOfFilm';

export default function Home() {
  const { guestName, shotsRemaining, isOutOfFilm, setGuestName, incrementShot } =
    useGuestSession();

  if (!guestName) return <NameEntry onSubmit={setGuestName} />;
  if (isOutOfFilm) return <OutOfFilm />;
  return (
    <CameraCapture
      guestName={guestName}
      shotsRemaining={shotsRemaining}
      onUploadSuccess={incrementShot}
    />
  );
}
