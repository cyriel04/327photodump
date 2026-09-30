'use client';

import { useGuestSession } from '@/lib/use-guest-session';
import { NameEntry } from '@/components/NameEntry';
import { CameraCapture } from '@/components/CameraCapture';
import { Gallery } from '@/components/Gallery';

export default function Home() {
  const { isLoaded, guestName, shotCount, shotsRemaining, isOutOfFilm, setGuestName, incrementShot, endSession } =
    useGuestSession();

  // Render nothing until the saved session is read; otherwise a refresh flashes
  // NameEntry before switching to the camera or gallery.
  if (!isLoaded) return null;
  if (!guestName) return <NameEntry onSubmit={setGuestName} />;
  if (isOutOfFilm) return <Gallery guestName={guestName} />;
  return (
    <CameraCapture
      guestName={guestName}
      shotsRemaining={shotsRemaining}
      shotCount={shotCount}
      onUploadSuccess={incrementShot}
      onEndSession={endSession}
    />
  );
}
