import { Card, CardContent } from '@/components/ui/card';

export function OutOfFilm() {
  return (
    <Card className="w-full max-w-sm text-center">
      <CardContent className="pt-10 pb-10 space-y-3">
        <p className="text-6xl">🎞</p>
        <h1 className="text-2xl font-bold">You&apos;re out of film!</h1>
        <p className="text-muted-foreground">Thanks for capturing your POV 🎞</p>
      </CardContent>
    </Card>
  );
}
