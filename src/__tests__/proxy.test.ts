/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config, proxy } from '@/proxy';
import { ACCESS_COOKIE, cookieValueFor } from '@/lib/access-code';

const env = process.env as Record<string, string | undefined>;
const originalNodeEnv = env.NODE_ENV;
const CODE = 'k7Qp2xVm-test';

function makeRequest(path: string, cookie?: string, origin = 'http://localhost') {
  const headers = cookie ? { cookie: `${ACCESS_COOKIE}=${cookie}` } : undefined;
  return new NextRequest(`${origin}${path}`, { headers });
}

function isPassThrough(res: Response) {
  return res.headers.get('x-middleware-next') === '1';
}

function rewriteTarget(res: Response) {
  return res.headers.get('x-middleware-rewrite');
}

beforeEach(() => {
  env.GUEST_ACCESS_CODE = CODE;
  env.NODE_ENV = 'production';
});

afterAll(() => {
  env.NODE_ENV = originalNodeEnv;
  delete env.GUEST_ACCESS_CODE;
});

describe('proxy — valid code in the URL', () => {
  it('sets the access cookie and redirects to the URL without the code', () => {
    const res = proxy(makeRequest(`/?code=${CODE}&utm=qr`));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/?utm=qr');
    const cookie = res.cookies.get(ACCESS_COOKIE);
    expect(cookie?.value).toBe(cookieValueFor(CODE));
    expect(cookie?.httpOnly).toBe(true);
  });

  it('marks the cookie secure on https', () => {
    const res = proxy(makeRequest(`/?code=${CODE}`, undefined, 'https://photos.example'));
    expect(res.cookies.get(ACCESS_COOKIE)?.secure).toBe(true);
  });

  it('does not mark the cookie secure on plain http (LAN testing), even in production', () => {
    const res = proxy(makeRequest(`/?code=${CODE}`, undefined, 'http://192.168.1.20:3000'));
    expect(res.cookies.get(ACCESS_COOKIE)?.value).toBe(cookieValueFor(CODE));
    expect(res.cookies.get(ACCESS_COOKIE)?.secure).toBeFalsy();
  });

  it('refreshes the cookie when a valid code arrives with a valid cookie', () => {
    const res = proxy(makeRequest(`/?code=${CODE}`, cookieValueFor(CODE)));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/');
    expect(res.cookies.get(ACCESS_COOKIE)?.value).toBe(cookieValueFor(CODE));
  });

  it('also accepts the code on an API path and strips it', () => {
    const res = proxy(makeRequest(`/api/gallery/feed?code=${CODE}&page=2`));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/api/gallery/feed?page=2');
    expect(res.cookies.get(ACCESS_COOKIE)?.value).toBe(cookieValueFor(CODE));
  });

  it('trims whitespace around GUEST_ACCESS_CODE', () => {
    env.GUEST_ACCESS_CODE = ' abc ';
    const res = proxy(makeRequest('/?code=abc'));
    expect(res.status).toBe(307);
    expect(res.cookies.get(ACCESS_COOKIE)?.value).toBe(cookieValueFor('abc'));
  });

  it('never stores the raw code in the cookie', () => {
    const res = proxy(makeRequest(`/?code=${CODE}`));
    expect(res.cookies.get(ACCESS_COOKIE)?.value).not.toContain(CODE);
  });
});

describe('proxy — without a valid code', () => {
  it('shows the locked page for a page request with no cookie', () => {
    const res = proxy(makeRequest('/'));
    expect(rewriteTarget(res)).toBe('http://localhost/locked');
  });

  it('shows the locked page for a wrong code and sets no cookie', () => {
    const res = proxy(makeRequest('/?code=wrong'));
    expect(rewriteTarget(res)).toBe('http://localhost/locked');
    expect(res.cookies.get(ACCESS_COOKIE)).toBeUndefined();
  });

  it('returns 401 for a wrong code on an API path with no cookie', () => {
    const res = proxy(makeRequest('/api/upload-session?code=wrong'));
    expect(res.status).toBe(401);
    expect(res.cookies.get(ACCESS_COOKIE)).toBeUndefined();
  });

  it('returns 401 for API requests with no cookie', async () => {
    const res = proxy(makeRequest('/api/upload-session'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
  });

  it('rejects a forged cookie', () => {
    expect(proxy(makeRequest('/api/gallery/feed', 'forged')).status).toBe(401);
  });

  it('rejects a cookie issued for a previous code', () => {
    const res = proxy(makeRequest('/api/gallery/feed', cookieValueFor('old-code')));
    expect(res.status).toBe(401);
  });
});

describe('proxy — with a valid cookie', () => {
  it('lets page and API requests through', () => {
    const cookie = cookieValueFor(CODE);
    expect(isPassThrough(proxy(makeRequest('/', cookie)))).toBe(true);
    expect(isPassThrough(proxy(makeRequest('/api/upload-session', cookie)))).toBe(true);
  });

  it('strips a wrong code without locking the guest out or touching the cookie', () => {
    const res = proxy(makeRequest('/?code=wrong&utm=qr', cookieValueFor(CODE)));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/?utm=qr');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(rewriteTarget(res)).toBeNull();
  });
});

describe('proxy — GUEST_ACCESS_CODE unset', () => {
  beforeEach(() => {
    delete env.GUEST_ACCESS_CODE;
  });

  it('fails closed in production', () => {
    expect(proxy(makeRequest('/api/gallery/feed')).status).toBe(401);
    expect(rewriteTarget(proxy(makeRequest('/')))).toBe('http://localhost/locked');
  });

  it('is open in development', () => {
    env.NODE_ENV = 'development';
    expect(isPassThrough(proxy(makeRequest('/')))).toBe(true);
  });
});

describe('proxy — matcher', () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it.each(['/', '/locked', '/api/gallery/feed', '/api/upload-session', '/api/debugx'])(
    'runs on %s',
    (url) => {
      expect(matches(url)).toBe(true);
    }
  );

  it.each(['/api/debug', '/api/debug/', '/favicon.ico', '/_next/static/a.js'])(
    'skips %s',
    (url) => {
      expect(matches(url)).toBe(false);
    }
  );
});
