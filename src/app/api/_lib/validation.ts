// Request validation shared by the API route handlers. Lives in a private
// (`_`-prefixed) folder so Next.js never treats it as a route.

export const MAX_GUEST_NAME_LENGTH = 50;
export const MAX_FILE_NAME_LENGTH = 200;
export const MAX_IMAGE_SIZE = 50 * 1024 * 1024;
export const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

/** Returns the trimmed guest name, or null if it is not a 1–50 char string. */
export function parseGuestName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_GUEST_NAME_LENGTH) return null;
  return trimmed;
}
