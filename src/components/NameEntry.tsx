'use client';

import { useState } from 'react';

interface Props {
  onSubmit: (name: string) => void;
}

export function NameEntry({ onSubmit }: Props) {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="name-entry">
      <h1>327 Photo Dump</h1>
      <p className="subtitle">Capture your wedding POV</p>
      <label htmlFor="name">What&apos;s your name?</label>
      <input
        id="name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name or nickname"
        autoFocus
      />
      <button type="submit" disabled={!name.trim()}>
        Start
      </button>
    </form>
  );
}
