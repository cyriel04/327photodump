'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

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
    <Card className="w-full max-w-sm">
      <CardHeader className="pb-2 space-y-0">
        <CardTitle className="text-2xl font-bold tracking-tight text-amber-400">
          327 Photo Dump
        </CardTitle>
        <CardDescription className="text-sm">Capture your wedding POV 🎞</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="name">What&apos;s your name?</Label>
            <Input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name or nickname"
              autoFocus
            />
          </div>
          <Button type="submit" disabled={!name.trim()} className="w-full bg-amber-400 text-black hover:bg-amber-300 font-semibold">
            Start
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
