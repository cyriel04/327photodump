// Guest access gate. The QR code at the venue links to /?code=<GUEST_ACCESS_CODE>;
// the proxy trades a matching code for a cookie, and every page and API request
// without that cookie is turned away. Server-only (uses node:crypto).

import { createHash, timingSafeEqual } from 'node:crypto';

export const ACCESS_COOKIE = 'guest_access';
export const ACCESS_QUERY_PARAM = 'code';
// The cookie outlives any wedding; changing GUEST_ACCESS_CODE invalidates it.
export const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

// Compare SHA-256 digests so both buffers are the same length and the
// comparison time does not reveal the secret's length or contents.
function secretsMatch(supplied: string, expected: string): boolean {
  return timingSafeEqual(sha256(supplied), sha256(expected));
}

/** The configured code, or null when unset/blank. */
export function getAccessCode(): string | null {
  const code = process.env.GUEST_ACCESS_CODE?.trim();
  return code ? code : null;
}

/**
 * The cookie stores a hash of the code rather than the code itself, so the
 * secret never sits in the browser's cookie jar and rotating the code
 * invalidates every existing cookie.
 */
export function cookieValueFor(code: string): string {
  return sha256(`327photodump:${code}`).toString('hex');
}

export function isValidCode(supplied: string | null | undefined, code: string): boolean {
  return typeof supplied === 'string' && secretsMatch(supplied, code);
}

export function isValidCookie(supplied: string | null | undefined, code: string): boolean {
  return typeof supplied === 'string' && secretsMatch(supplied, cookieValueFor(code));
}
