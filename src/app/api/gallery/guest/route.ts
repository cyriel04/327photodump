import { NextRequest, NextResponse } from 'next/server';
import { listGuestFiles } from '@/lib/google-drive';

export async function GET(request: NextRequest) {
  const guestName = request.nextUrl.searchParams.get('guestName');

  if (!guestName) {
    return NextResponse.json({ error: 'Missing guestName' }, { status: 400 });
  }

  try {
    const files = await listGuestFiles(guestName);
    return NextResponse.json({ files });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Gallery guest error:', message);
    return NextResponse.json({ error: 'Failed to load guest files', detail: message }, { status: 500 });
  }
}
