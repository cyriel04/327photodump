'use client';

import { useState, useEffect } from 'react';

const MAX_SHOTS = 30;

export function useGuestSession() {
  const [guestName, setGuestNameState] = useState<string | null>(null);
  const [shotCount, setShotCount] = useState(0);

  useEffect(() => {
    const storedName = localStorage.getItem('guestName');
    if (storedName) {
      const count = parseInt(localStorage.getItem(`shotCount_${storedName}`) ?? '0', 10);
      setGuestNameState(storedName);
      setShotCount(count);
    }
  }, []);

  const setGuestName = (name: string) => {
    localStorage.setItem('guestName', name);
    const count = parseInt(localStorage.getItem(`shotCount_${name}`) ?? '0', 10);
    setGuestNameState(name);
    setShotCount(count);
  };

  const incrementShot = () => {
    if (!guestName) return;
    const newCount = shotCount + 1;
    localStorage.setItem(`shotCount_${guestName}`, String(newCount));
    setShotCount(newCount);
  };

  return {
    guestName,
    shotCount,
    shotsRemaining: MAX_SHOTS - shotCount,
    isOutOfFilm: shotCount >= MAX_SHOTS,
    setGuestName,
    incrementShot,
  };
}
