// Request validation shared by the API route handlers. Lives in a private
// (`_`-prefixed) folder so Next.js never treats it as a route.

import { MAX_GUEST_NAME_LENGTH } from '@/lib/upload-limits';

// Limits live in @/lib/upload-limits so the client pre-checks and the server
// validation can never drift apart. Re-exported for the route handlers.
export {
  MAX_GUEST_NAME_LENGTH,
  MAX_FILE_NAME_LENGTH,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
} from '@/lib/upload-limits';

/** Returns the trimmed guest name, or null if it is not a 1–50 char string. */
export function parseGuestName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_GUEST_NAME_LENGTH) return null;
  return trimmed;
}
