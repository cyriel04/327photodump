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

const mockGetAuth = getAuth as jest.Mock;
const env = process.env as Record<string, string | undefined>;
const originalNodeEnv = env.NODE_ENV;

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
    const res = await GET(makeRequest('?token='));
    expect(res.status).toBe(404);
    expect(mockGetAuth).not.toHaveBeenCalled();
  });

  it('returns 404 in production when the token is missing or wrong', async () => {
    env.NODE_ENV = 'production';
    env.DEBUG_TOKEN = 'correct-token';

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

  it('runs without a token outside production', async () => {
    env.NODE_ENV = 'development';
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
  });
});
