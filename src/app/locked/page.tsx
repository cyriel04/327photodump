import type { Metadata } from 'next';
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

export const metadata: Metadata = {
  robots: { index: false },
};

// Shown (via a proxy rewrite) to anyone without a valid guest access cookie.
export default function Locked() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="space-y-2">
        <CardTitle className="text-2xl font-bold tracking-tight text-amber-400">
          327 Photo Dump
        </CardTitle>
        <CardDescription className="text-sm">
          This camera is for wedding guests only. Scan the QR code at the venue to start shooting 🎞
        </CardDescription>
      </CardHeader>
    </Card>
  );
}
