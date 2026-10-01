import { NextRequest, NextResponse } from 'next/server';
import {
  ACCESS_COOKIE,
  ACCESS_COOKIE_MAX_AGE,
  ACCESS_QUERY_PARAM,
  cookieValueFor,
  getAccessCode,
  isValidCode,
  isValidCookie,
} from '@/lib/access-code';

function deny(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  // Keep the URL as-is; just render the "scan the QR code" page instead.
  return NextResponse.rewrite(new URL('/locked', request.url));
}

export function proxy(request: NextRequest) {
  const code = getAccessCode();

  if (!code) {
    // Fail closed in production so a missing env var never leaves the camera
    // and gallery open. Locally, no code means no gate.
    return process.env.NODE_ENV === 'production' ? deny(request) : NextResponse.next();
  }

  const hasValidCookie = isValidCookie(request.cookies.get(ACCESS_COOKIE)?.value, code);
  const suppliedCode = request.nextUrl.searchParams.get(ACCESS_QUERY_PARAM);

  if (suppliedCode !== null) {
    // Strip the code from the address bar so it isn't shared by screenshots
    // or left in browser history.
    const cleanUrl = request.nextUrl.clone();
    cleanUrl.searchParams.delete(ACCESS_QUERY_PARAM);

    if (!isValidCode(suppliedCode, code)) {
      // A stale or mistyped link shouldn't lock out a guest who already has
      // a valid cookie: drop the bad code and keep their existing cookie.
      return hasValidCookie ? NextResponse.redirect(cleanUrl) : deny(request);
    }

    // Remember the guest with a cookie.
    const response = NextResponse.redirect(cleanUrl);
    response.cookies.set(ACCESS_COOKIE, cookieValueFor(code), {
      httpOnly: true,
      // Follow the actual request scheme so LAN testing over plain http
      // (`next start` on a phone) still gets a cookie the browser keeps.
      secure: request.nextUrl.protocol === 'https:',
      sameSite: 'lax',
      path: '/',
      maxAge: ACCESS_COOKIE_MAX_AGE,
    });
    return response;
  }

  if (hasValidCookie) {
    return NextResponse.next();
  }

  return deny(request);
}

export const config = {
  matcher: [
    // Everything except Next.js assets, files with an extension (public/,
    // favicon) and /api/debug (exactly, or /api/debug/...), which has its own
    // DEBUG_TOKEN gate. `(?:/|$)` keeps look-alikes such as /api/debugx gated.
    '/((?!_next/static|_next/image|api/debug(?:/|$)|.*\\.[\\w]+$).*)',
  ],
};
