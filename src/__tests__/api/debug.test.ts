/**
 * @jest-environment node
 */
import { GET } from '@/app/api/debug/route';
import { NextRequest } from 'next/server';
import { getAuth } from '@/lib/google-drive';

jest.mock('@/lib/google-drive', () => ({
  getAuth: jest.fn(),
}));

jest.mock('googleapis', () => ({
  google: { drive: jest.fn() },
}));

const { google: mockGoogle } = jest.requireMock('googleapis');
const mockDrive: jest.Mock = mockGoogle.drive;

const mockGetAuth = getAuth as jest.Mock;
const env = process.env as Record<string, string | undefined>;
const originalNodeEnv = env.NODE_ENV;

function setOAuthEnv() {
  // With credentials present, a request that got past the gate would reach
  // getAuth(), so `not.toHaveBeenCalled()` genuinely proves the gate held.
  env.GOOGLE_CLIENT_ID = 'test-client-id';
  env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
}

function makeRequest(query = '') {
  return new NextRequest(`http://localhost/api/debug${query}`);
}

beforeEach(() => {
  mockGetAuth.mockClear();
  delete env.DEBUG_TOKEN;
  // No OAuth credentials: the route returns its env-var report before touching Drive.
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
  delete env.GOOGLE_REFRESH_TOKEN;
  env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root-folder-id-1234';
});

afterAll(() => {
  env.NODE_ENV = originalNodeEnv;
});

describe('GET /api/debug', () => {
  it('returns 404 in production when DEBUG_TOKEN is not set', async () => {
    env.NODE_ENV = 'production';
    setOAuthEnv();
    const res = await GET(makeRequest('?token='));
    expect(res.status).toBe(404);
    expect(mockGetAuth).not.toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toContain('test-refresh-token');
    expect(text).not.toContain('root-folder-id');
  });

  it('returns 404 in production when the token is missing or wrong', async () => {
    env.NODE_ENV = 'production';
    env.DEBUG_TOKEN = 'correct-token';
    setOAuthEnv();

    expect((await GET(makeRequest())).status).toBe(404);
    expect((await GET(makeRequest('?token=wrong-token'))).status).toBe(404);
    expect((await GET(makeRequest('?token=correct-token-extra'))).status).toBe(404);
    expect(mockGetAuth).not.toHaveBeenCalled();
  });

  it('runs in production when the correct token is supplied', async () => {
    env.NODE_ENV = 'production';
    env.DEBUG_TOKEN = 'correct-token';

    const res = await GET(makeRequest('?token=correct-token'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hasClientId).toBe('MISSING');
    expect(body.folderIdHint).toBe('root…1234');
  });

  it('reaches getAuth once past the gate when credentials are set (control for the gate tests)', async () => {
    env.NODE_ENV = 'production';
    env.DEBUG_TOKEN = 'correct-token';
    setOAuthEnv();
    mockGetAuth.mockImplementation(() => {
      throw new Error('auth unavailable in test');
    });

    const res = await GET(makeRequest('?token=correct-token'));

    expect(res.status).toBe(200);
    expect(mockGetAuth).toHaveBeenCalled();
    const text = await res.text();
    expect(text).not.toContain('test-refresh-token');
    expect(text).not.toContain('test-client-secret');
    mockGetAuth.mockReset();
  });

  describe('with credentials and a cached access token on the shared client', () => {
    const originalFetch = global.fetch;
    let getAccessToken: jest.Mock;
    let refreshAccessToken: jest.Mock;
    let mockFetch: jest.Mock;

    beforeEach(() => {
      env.NODE_ENV = 'development';
      setOAuthEnv();
      // getAccessToken() would happily hand back this cached token without
      // contacting Google — the route must not rely on it.
      getAccessToken = jest.fn().mockResolvedValue({ token: 'cached-access-token' });
      refreshAccessToken = jest.fn();
      mockGetAuth.mockReturnValue({ getAccessToken, refreshAccessToken });
      mockDrive.mockReturnValue({
        files: {
          get: jest.fn().mockResolvedValue({ data: { name: 'Wedding' } }),
          create: jest.fn().mockResolvedValue({ data: { id: 'tmp-folder' } }),
          delete: jest.fn().mockResolvedValue({}),
        },
      });
      mockFetch = jest.fn().mockResolvedValue(new Response(null, { status: 200 }));
      global.fetch = mockFetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      mockGetAuth.mockReset();
      mockDrive.mockReset();
    });

    it('reports auth FAILED when the refresh token is rejected, even though a token is cached', async () => {
      refreshAccessToken.mockRejectedValue(new Error('invalid_grant'));

      const res = await GET(makeRequest());
      const text = await res.text();
      const body = JSON.parse(text);

      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(body.auth).toBe('FAILED: invalid_grant');
      // Stops before the Drive checks, as it always has on an auth failure.
      expect(body.folderRead).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
      expect(text).not.toContain('cached-access-token');
      expect(text).not.toContain('test-refresh-token');
      expect(text).not.toContain('test-client-secret');
    });

    it('trades the refresh token and uses the fresh token for the resumable-session check', async () => {
      refreshAccessToken.mockResolvedValue({ credentials: { access_token: 'fresh-access-token' } });

      const res = await GET(makeRequest());
      const text = await res.text();
      const body = JSON.parse(text);

      expect(refreshAccessToken).toHaveBeenCalledTimes(1);
      expect(body.auth).toBe('ok');
      expect(body.folderRead).toBe('ok — found: Wedding');
      expect(body.writeAccess).toBe('ok — created and deleted a test folder');
      expect(body.resumableSession).toBe('ok — got upload URL');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer fresh-access-token');
      expect(text).not.toContain('fresh-access-token');
      expect(text).not.toContain('cached-access-token');
      expect(text).not.toContain('test-refresh-token');
    });

    it('reports auth FAILED when the refresh returns no access token', async () => {
      refreshAccessToken.mockResolvedValue({ credentials: {} });

      const body = await (await GET(makeRequest())).json();

      expect(body.auth).toBe('FAILED — no token returned');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  it('runs without a token outside production', async () => {
    env.NODE_ENV = 'development';
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });
});
