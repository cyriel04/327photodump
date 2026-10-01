import { NextRequest, NextResponse } from 'next/server';
import { fetchGuestVideo, isDriveFileId } from '@/lib/google-drive';
import { clampRange, MAX_CHUNK_BYTES, parseContentRange } from '../_lib/range';

// Drive's own player shows its controls and iOS Safari's native ones at once, so
// the lightbox plays videos from here with a plain <video> instead. Drive's
// download links can't be used directly: they send Cross-Origin-Resource-Policy
// same-site. Range requests pass through because iOS won't play video without them.

function failed(status: number) {
  return NextResponse.json({ error: 'Failed to load video' }, { status });
}

/** Release the upstream connection when we aren't relaying its body. */
async function discard(body: ReadableStream | null) {
  try {
    await body?.cancel();
  } catch {
    // Nothing useful to do; the socket is closed either way.
  }
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id || !isDriveFileId(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  }

  const requestedRange = request.headers.get('range');
  const range = clampRange(requestedRange);
  if (!range) {
    return new NextResponse(null, { status: 416 });
  }

  try {
    // request.signal aborts the Drive download when the player abandons a range (seeking).
    const video = await fetchGuestVideo(id, range, request.signal);
    if (!video) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const { mimeType, media } = video;

    if (media.status === 416) {
      await discard(media.body);
      const contentRange = media.headers.get('content-range');
      return new NextResponse(null, { status: 416, headers: contentRange ? { 'content-range': contentRange } : undefined });
    }

    const contentLength = media.headers.get('content-length');
    const partial = media.status === 206 ? parseContentRange(media.headers.get('content-range')) : null;
    // A 200 means Drive ignored the range: only relay it if it provably fits in
    // one function response. A 206 must say which bytes it carries.
    const relayable =
      media.body !== null &&
      (partial !== null ||
        (media.status === 200 && contentLength !== null && Number(contentLength) <= MAX_CHUNK_BYTES));
    if (!relayable) {
      await discard(media.body);
      console.error('Video stream error:', media.status);
      return failed(502);
    }

    const headers = new Headers({
      'content-type': mimeType,
      'accept-ranges': 'bytes',
      // Matches the server's guest-video check TTL, so a trashed video stops
      // replaying from browser cache about as soon as the server refuses it.
      'cache-control': 'private, max-age=300',
      // Guest-uploaded bytes served from our origin: never let a browser sniff
      // them into HTML or run them as a document.
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    });
    if (contentLength) headers.set('content-length', contentLength);

    let status = media.status;
    if (partial) {
      // A plain GET (no Range) should get a 200. We can honour that when the
      // first chunk is the whole file; a bigger file still gets a 206 because we
      // can't send more than one chunk (media elements always send Range anyway).
      const wholeFile = partial.start === 0 && partial.end === partial.total - 1;
      if (requestedRange === null && wholeFile) {
        status = 200;
      } else {
        headers.set('content-range', media.headers.get('content-range')!);
      }
    }

    return new NextResponse(media.body, { status, headers });
  } catch (error) {
    // The player abandoned this range (seek/close); nobody is listening.
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    const message = error instanceof Error ? error.message : String(error);
    console.error('Video stream error:', message);
    return failed(500);
  }
}
