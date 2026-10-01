// Each /api/video response carries at most this many bytes. Vercel caps a
// function response at 4.5 MB; a media element just asks for the next range.
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

const SINGLE_RANGE = /^bytes=(\d+)-(\d*)$/;
const CONTENT_RANGE = /^bytes (\d+)-(\d+)\/(\d+)$/;

/**
 * Turn a request's `Range` header into one no bigger than MAX_CHUNK_BYTES.
 * No header means "from the start". Returns null for anything that isn't a
 * single `bytes=start-[end]` range (suffix and multi-ranges are unsupported).
 *
 * Answering an open-ended `bytes=N-` with a shorter 206 is allowed (the
 * Content-Range says what was sent) and media elements simply request the rest.
 */
export function clampRange(header: string | null): string | null {
  if (header === null) return `bytes=0-${MAX_CHUNK_BYTES - 1}`;
  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return null;
  const start = Number(match[1]);
  if (!Number.isSafeInteger(start)) return null;
  const maxEnd = start + MAX_CHUNK_BYTES - 1;
  const end = match[2] === '' ? maxEnd : Math.min(Number(match[2]), maxEnd);
  if (end < start) return null;
  return `bytes=${start}-${end}`;
}

/** Parse a satisfied `Content-Range: bytes start-end/total`; null otherwise. */
export function parseContentRange(header: string | null): { start: number; end: number; total: number } | null {
  const match = header ? CONTENT_RANGE.exec(header.trim()) : null;
  if (!match) return null;
  return { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
}
