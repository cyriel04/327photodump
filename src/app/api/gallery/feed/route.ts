import { NextResponse } from 'next/server';
import { listGuestsByActivity } from '@/lib/google-drive';

export async function GET() {
  try {
    const guests = await listGuestsByActivity();
    return NextResponse.json({ guests });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Gallery feed error:', message);
    return NextResponse.json({ error: 'Failed to load feed', detail: message }, { status: 500 });
  }
}
