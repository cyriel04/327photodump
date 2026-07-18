'use client';

import { useGuestSession } from '@/lib/use-guest-session';
import { NameEntry } from '@/components/NameEntry';
import { CameraCapture } from '@/components/CameraCapture';
import { Gallery } from '@/components/Gallery';

export default function Home() {
  const { guestName, shotsRemaining, isOutOfFilm, setGuestName, incrementShot } =
    useGuestSession();

  if (!guestName) return <NameEntry onSubmit={setGuestName} />;
  if (isOutOfFilm) return <Gallery guestName={guestName} />;
  return (
    <CameraCapture
      guestName={guestName}
      shotsRemaining={shotsRemaining}
      onUploadSuccess={incrementShot}
    />
  );
}
