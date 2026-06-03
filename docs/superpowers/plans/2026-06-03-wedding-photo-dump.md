# Wedding Photo Dump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first Next.js web app that lets wedding guests capture and upload photos/videos (up to 30 each) directly to a shared Google Drive folder, organized by guest name.

**Architecture:** One Next.js App Router page with one API route. The API route authenticates with Google Drive via OAuth2 (refresh token) and returns a resumable upload URL. The client uploads files directly to Google Drive using that URL — bypassing Vercel's 4.5MB serverless body size limit. Shot count is tracked in localStorage (30-shot disposable camera limit).

**Tech Stack:** Next.js (App Router), TypeScript, shadcn/ui, Tailwind CSS v4, `googleapis` npm package, Google Drive API v3 (resumable uploads), Jest + React Testing Library, Vercel

> **IMPORTANT — Read the framework docs first:**  
> This project's Next.js version may differ from your training data. Before writing any code, read `node_modules/next/dist/docs/` for the actual API. Pay attention to deprecation notices.

---

## File Map

| File | Responsibility |
|---|---|
| `src/app/page.tsx` | Orchestrates the three app states (name entry → camera → out of film) |
| `src/app/layout.tsx` | Root layout — dark mode, Geist font, viewport export |
| `src/app/globals.css` | Tailwind CSS v4 base styles |
| `src/app/api/upload-session/route.ts` | POST: finds/creates guest Drive folder, returns resumable upload URL |
| `src/app/api/debug/route.ts` | GET: diagnostic endpoint — tests auth, read, write, session creation |
| `src/components/NameEntry.tsx` | Name input form — first screen (iOS-safe, no form/disabled/autoFocus) |
| `src/components/CameraCapture.tsx` | Capture buttons, preview, progress bar, direct XHR upload to Drive |
| `src/components/OutOfFilm.tsx` | End-of-shots screen |
| `src/lib/google-drive.ts` | OAuth2 auth, folder lookup/creation, resumable session init |
| `src/lib/use-guest-session.ts` | Custom hook: guest name + shot count via localStorage |
| `src/types/index.ts` | Shared TypeScript interfaces |
| `next.config.ts` | `allowedDevOrigins: ['*']` for LAN mobile testing |
| `jest.config.js` | Jest configuration with explicit `@/` moduleNameMapper |
| `jest.setup.ts` | Jest setup: imports @testing-library/jest-dom |
| `src/__tests__/lib/google-drive.test.ts` | Unit tests for Drive lib |
| `src/__tests__/api/upload-session.test.ts` | Unit tests for API route |
| `src/__tests__/lib/use-guest-session.test.ts` | Unit tests for session hook |
| `src/__tests__/components/NameEntry.test.tsx` | Component tests |
| `src/__tests__/components/CameraCapture.test.tsx` | Component tests |
| `src/__tests__/components/OutOfFilm.test.tsx` | Component tests |

---

### Task 1: Scaffold the Next.js Project

**Files:**
- Create: all Next.js scaffold files in project root

- [ ] **Step 1: Initialize Next.js project with shadcn/ui**

```bash
npx create-next-app@latest . --typescript --app --tailwind --src-dir --import-alias "@/*" --eslint
```

When prompted for Turbopack → No.

- [ ] **Step 2: Install shadcn/ui and initialize**

```bash
npx shadcn@latest init
```

Accept defaults (dark theme, CSS variables). Then add the components used by the app:

```bash
npx shadcn@latest add button card input progress
```

- [ ] **Step 3: Install googleapis**

```bash
npm install googleapis
```

- [ ] **Step 4: Configure LAN access in next.config.ts**

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['*'],
};

export default nextConfig;
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit scaffold**

```bash
git add .
git commit -m "chore: scaffold Next.js project with shadcn/ui and googleapis"
```

---

### Task 2: Configure Jest

**Files:**
- Modify: `package.json`
- Create: `jest.config.js`
- Create: `jest.setup.ts`

- [ ] **Step 1: Install test dependencies**

```bash
npm install --save-dev jest jest-environment-jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/jest
```

- [ ] **Step 2: Add test scripts to package.json**

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "jest",
  "test:watch": "jest --watch"
}
```

- [ ] **Step 3: Create jest.config.js**

> **Critical:** `next/jest` does NOT automatically map tsconfig path aliases. The `moduleNameMapper` entry for `@/` is required or all `@/` imports in tests will fail.

```js
const nextJest = require('next/jest');
const createJestConfig = nextJest({ dir: './' });
module.exports = createJestConfig({
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
});
```

- [ ] **Step 4: Create jest.setup.ts**

```typescript
import '@testing-library/jest-dom';
```

- [ ] **Step 5: Run tests to verify Jest is working**

```bash
npm test -- --passWithNoTests
```

Expected: Jest runs and exits with 0 failures.

- [ ] **Step 6: Commit**

```bash
git add jest.config.js jest.setup.ts package.json
git commit -m "chore: configure Jest with moduleNameMapper for @/ alias"
```

---

### Task 3: Define Shared TypeScript Types

**Files:**
- Create: `src/types/index.ts`

- [ ] **Step 1: Create src/types/index.ts**

```typescript
export interface UploadSessionRequest {
  guestName: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface UploadSessionResponse {
  uploadUrl: string;
  folderId: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "chore: add shared TypeScript types"
```

---

### Task 4: Google Drive Library (TDD)

**Files:**
- Create: `src/lib/google-drive.ts`
- Create: `src/__tests__/lib/google-drive.test.ts`

> **Why OAuth2, not a service account:**  
> Service accounts have no Google Drive storage quota. Files they create fail with `403: Service Accounts do not have storage quota`. Use OAuth2 with the owner's refresh token so files are owned by the real Google account.

> **Why pass `origin` to createResumableUploadSession:**  
> Google only enables CORS on a resumable session URI if the session-creation POST includes an `Origin` header. Without it, the browser's cross-origin PUT fires `xhr.onerror` (not `xhr.onload`) and the upload silently fails. Forward the client's `Origin` header from the route to this function.

- [ ] **Step 1: Create the test file**

Create `src/__tests__/lib/google-drive.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import { findOrCreateGuestFolder, createResumableUploadSession } from '@/lib/google-drive';

const mockFilesList = jest.fn();
const mockFilesCreate = jest.fn();
const mockGetAccessToken = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
        getAccessToken: mockGetAccessToken,
      })),
    },
    drive: jest.fn().mockReturnValue({
      files: {
        list: mockFilesList,
        create: mockFilesCreate,
      },
    }),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root-folder-id';
});

describe('findOrCreateGuestFolder', () => {
  it('returns existing folder id when folder already exists', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [{ id: 'existing-folder-id' }] } });

    const result = await findOrCreateGuestFolder('Cyriel');

    expect(result).toBe('existing-folder-id');
    expect(mockFilesCreate).not.toHaveBeenCalled();
  });

  it('creates and returns new folder id when folder does not exist', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });
    mockFilesCreate.mockResolvedValue({ data: { id: 'new-folder-id' } });

    const result = await findOrCreateGuestFolder('Cyriel');

    expect(result).toBe('new-folder-id');
    expect(mockFilesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          name: 'Cyriel',
          mimeType: 'application/vnd.google-apps.folder',
          parents: ['root-folder-id'],
        }),
      })
    );
  });
});

describe('createResumableUploadSession', () => {
  it('returns the upload URL from the Location header', async () => {
    mockGetAccessToken.mockResolvedValue({ token: 'mock-access-token' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (h: string) => (h === 'Location' ? 'https://upload.googleapis.com/upload-url' : null),
      },
    }) as jest.Mock;

    const result = await createResumableUploadSession(
      'folder-id',
      'photo-2026-06-03.jpg',
      'image/jpeg',
      1024000,
      'https://327photodump.vercel.app'
    );

    expect(result).toBe('https://upload.googleapis.com/upload-url');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('uploadType=resumable'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Origin: 'https://327photodump.vercel.app' }),
      })
    );
  });

  it('throws with Google error body when Drive returns non-ok response', async () => {
    mockGetAccessToken.mockResolvedValue({ token: 'mock-access-token' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"error":{"message":"Service Accounts do not have storage quota."}}',
    }) as jest.Mock;

    await expect(
      createResumableUploadSession('folder-id', 'photo.jpg', 'image/jpeg', 1024)
    ).rejects.toThrow('Drive resumable session failed (403)');
  });

  it('throws when Drive does not return a Location header', async () => {
    mockGetAccessToken.mockResolvedValue({ token: 'mock-access-token' });
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => null },
    }) as jest.Mock;

    await expect(
      createResumableUploadSession('folder-id', 'photo.jpg', 'image/jpeg', 1024)
    ).rejects.toThrow('Failed to get upload URL from Google Drive');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/__tests__/lib/google-drive.test.ts
```

Expected: FAIL — "Cannot find module '@/lib/google-drive'"

- [ ] **Step 3: Create src/lib/google-drive.ts**

```typescript
import { google } from 'googleapis';

function getAuth() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    'urn:ietf:wg:oauth:2.0:oob',
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN! });
  return oauth2Client;
}

export async function findOrCreateGuestFolder(guestName: string): Promise<string> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;

  const response = await drive.files.list({
    q: `name='${guestName}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });

  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id!;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: guestName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId],
    },
    fields: 'id',
  });

  return folder.data.id!;
}

export async function createResumableUploadSession(
  folderId: string,
  fileName: string,
  mimeType: string,
  fileSize: number,
  origin?: string,
): Promise<string> {
  const auth = getAuth();
  const { token } = await auth.getAccessToken();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Upload-Content-Type': mimeType,
    'X-Upload-Content-Length': String(fileSize),
  };

  // Including Origin tells Google to enable CORS on the returned session URI,
  // allowing the browser to PUT the file directly to Google Drive.
  if (origin) headers['Origin'] = origin;

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Drive resumable session failed (${response.status}): ${body}`);
  }

  const uploadUrl = response.headers.get('Location');
  if (!uploadUrl) throw new Error('Failed to get upload URL from Google Drive');
  return uploadUrl;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/__tests__/lib/google-drive.test.ts
```

Expected: PASS — all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/google-drive.ts src/__tests__/lib/google-drive.test.ts
git commit -m "feat: add Google Drive lib with OAuth2 and CORS-aware upload sessions"
```

---

### Task 5: Upload Session API Route (TDD)

**Files:**
- Create: `src/app/api/upload-session/route.ts`
- Create: `src/__tests__/api/upload-session.test.ts`

- [ ] **Step 1: Create the test file**

Create `src/__tests__/api/upload-session.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import { POST } from '@/app/api/upload-session/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/google-drive', () => ({
  findOrCreateGuestFolder: jest.fn().mockResolvedValue('folder-id-123'),
  createResumableUploadSession: jest
    .fn()
    .mockResolvedValue('https://upload.googleapis.com/session-url'),
}));

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/upload-session', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', origin: 'https://327photodump.vercel.app' },
  });
}

describe('POST /api/upload-session', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await POST(makeRequest({ guestName: 'Cyriel' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when video exceeds 100MB', async () => {
    const res = await POST(
      makeRequest({
        guestName: 'Cyriel',
        fileName: 'video.mp4',
        mimeType: 'video/mp4',
        fileSize: 101 * 1024 * 1024,
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Video too large');
  });

  it('returns 200 with uploadUrl and folderId on success', async () => {
    const res = await POST(
      makeRequest({
        guestName: 'Cyriel',
        fileName: 'photo-2026-06-03.jpg',
        mimeType: 'image/jpeg',
        fileSize: 2048000,
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uploadUrl).toBe('https://upload.googleapis.com/session-url');
    expect(body.folderId).toBe('folder-id-123');
  });

  it('returns 200 for video within 100MB', async () => {
    const res = await POST(
      makeRequest({
        guestName: 'Cyriel',
        fileName: 'video.mp4',
        mimeType: 'video/mp4',
        fileSize: 50 * 1024 * 1024,
      })
    );
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/__tests__/api/upload-session.test.ts
```

Expected: FAIL — "Cannot find module '@/app/api/upload-session/route'"

- [ ] **Step 3: Create src/app/api/upload-session/route.ts**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { findOrCreateGuestFolder, createResumableUploadSession } from '@/lib/google-drive';
import { UploadSessionRequest, UploadSessionResponse } from '@/types';

const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const body: UploadSessionRequest = await request.json();
    const { guestName, fileName, mimeType, fileSize } = body;

    if (!guestName || !fileName || !mimeType || !fileSize) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (mimeType.startsWith('video/') && fileSize > MAX_VIDEO_SIZE) {
      return NextResponse.json({ error: 'Video too large' }, { status: 400 });
    }

    // Forward the client Origin so Google enables CORS on the returned session URI
    const origin = request.headers.get('origin') ?? undefined;
    const folderId = await findOrCreateGuestFolder(guestName);
    const uploadUrl = await createResumableUploadSession(folderId, fileName, mimeType, fileSize, origin);

    const response: UploadSessionResponse = { uploadUrl, folderId };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Upload session error:', message);
    return NextResponse.json({ error: 'Failed to create upload session', detail: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/__tests__/api/upload-session.test.ts
```

Expected: PASS — all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/upload-session/route.ts src/__tests__/api/upload-session.test.ts
git commit -m "feat: add upload-session API route"
```

---

### Task 6: useGuestSession Hook (TDD)

**Files:**
- Create: `src/lib/use-guest-session.ts`
- Create: `src/__tests__/lib/use-guest-session.test.ts`

> **Safari Private Browsing:** localStorage throws in Safari Private mode. Wrap every call in try/catch with an in-memory fallback.

- [ ] **Step 1: Create the test file**

Create `src/__tests__/lib/use-guest-session.test.ts`:

```typescript
import { renderHook, act } from '@testing-library/react';
import { useGuestSession } from '@/lib/use-guest-session';

beforeEach(() => {
  localStorage.clear();
});

describe('useGuestSession', () => {
  it('returns null guestName and 0 shotCount when localStorage is empty', () => {
    const { result } = renderHook(() => useGuestSession());
    expect(result.current.guestName).toBeNull();
    expect(result.current.shotCount).toBe(0);
    expect(result.current.shotsRemaining).toBe(30);
    expect(result.current.isOutOfFilm).toBe(false);
  });

  it('restores guestName and shotCount from localStorage on mount', () => {
    localStorage.setItem('guestName', 'Cyriel');
    localStorage.setItem('shotCount_Cyriel', '12');

    const { result } = renderHook(() => useGuestSession());
    expect(result.current.guestName).toBe('Cyriel');
    expect(result.current.shotCount).toBe(12);
    expect(result.current.shotsRemaining).toBe(18);
  });

  it('setGuestName saves name to localStorage and updates state', () => {
    const { result } = renderHook(() => useGuestSession());

    act(() => { result.current.setGuestName('Maria'); });

    expect(result.current.guestName).toBe('Maria');
    expect(localStorage.getItem('guestName')).toBe('Maria');
  });

  it('incrementShot increases count and persists to localStorage', () => {
    const { result } = renderHook(() => useGuestSession());

    act(() => { result.current.setGuestName('Cyriel'); });
    act(() => { result.current.incrementShot(); });

    expect(result.current.shotCount).toBe(1);
    expect(localStorage.getItem('shotCount_Cyriel')).toBe('1');
  });

  it('isOutOfFilm is true when shotCount reaches 30', () => {
    localStorage.setItem('guestName', 'Cyriel');
    localStorage.setItem('shotCount_Cyriel', '30');

    const { result } = renderHook(() => useGuestSession());
    expect(result.current.isOutOfFilm).toBe(true);
    expect(result.current.shotsRemaining).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/__tests__/lib/use-guest-session.test.ts
```

Expected: FAIL — "Cannot find module '@/lib/use-guest-session'"

- [ ] **Step 3: Create src/lib/use-guest-session.ts**

```typescript
'use client';

import { useState, useEffect } from 'react';

const MAX_SHOTS = 30;

// Safari Private Browsing throws on localStorage access — fall back to memory
const store: Record<string, string> = {};

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return store[key] ?? null; }
}

function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { store[key] = value; }
}

export function useGuestSession() {
  const [guestName, setGuestNameState] = useState<string | null>(null);
  const [shotCount, setShotCount] = useState(0);

  useEffect(() => {
    const storedName = lsGet('guestName');
    if (storedName) {
      const count = parseInt(lsGet(`shotCount_${storedName}`) ?? '0', 10);
      setGuestNameState(storedName);
      setShotCount(count);
    }
  }, []);

  const setGuestName = (name: string) => {
    lsSet('guestName', name);
    const count = parseInt(lsGet(`shotCount_${name}`) ?? '0', 10);
    setGuestNameState(name);
    setShotCount(count);
  };

  const incrementShot = () => {
    if (!guestName) return;
    const newCount = shotCount + 1;
    lsSet(`shotCount_${guestName}`, String(newCount));
    setShotCount(newCount);
  };

  return {
    guestName,
    shotCount,
    shotsRemaining: MAX_SHOTS - shotCount,
    isOutOfFilm: shotCount >= MAX_SHOTS,
    setGuestName,
    incrementShot,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/__tests__/lib/use-guest-session.test.ts
```

Expected: PASS — all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/use-guest-session.ts src/__tests__/lib/use-guest-session.test.ts
git commit -m "feat: add useGuestSession hook with Safari Private Browsing fallback"
```

---

### Task 7: NameEntry Component (TDD)

**Files:**
- Create: `src/components/NameEntry.tsx`
- Create: `src/__tests__/components/NameEntry.test.tsx`

> **iOS quirks in this component:**
> - No `<form>` element — iOS fires a page refresh on submit
> - No `disabled` prop on the button — iOS drops taps near disabled buttons. Use Tailwind opacity classes instead
> - No `autoFocus` — opens the virtual keyboard immediately, pushing the button off-screen

- [ ] **Step 1: Create the test file**

Create `src/__tests__/components/NameEntry.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NameEntry } from '@/components/NameEntry';

describe('NameEntry', () => {
  it('renders name input and start button', () => {
    render(<NameEntry onSubmit={jest.fn()} />);
    expect(screen.getByPlaceholderText(/name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
  });

  it('calls onSubmit with trimmed name when button is clicked', async () => {
    const onSubmit = jest.fn();
    render(<NameEntry onSubmit={onSubmit} />);

    await userEvent.type(screen.getByPlaceholderText(/name/i), '  Cyriel  ');
    await userEvent.click(screen.getByRole('button', { name: /start/i }));

    expect(onSubmit).toHaveBeenCalledWith('Cyriel');
  });

  it('does not call onSubmit when name is empty', async () => {
    const onSubmit = jest.fn();
    render(<NameEntry onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole('button', { name: /start/i }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- src/__tests__/components/NameEntry.test.tsx
```

- [ ] **Step 3: Create src/components/NameEntry.tsx**

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

interface Props {
  onSubmit: (name: string) => void;
}

export function NameEntry({ onSubmit }: Props) {
  const [name, setName] = useState('');

  const handleStart = () => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-2xl text-amber-400">327 Photo Dump</CardTitle>
        <CardDescription>Capture your wedding POV</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">What&apos;s your name?</label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name or nickname"
            onKeyDown={(e) => { if (e.key === 'Enter') handleStart(); }}
          />
        </div>
        {/* No disabled prop — iOS drops taps near disabled buttons.
            Simulate disabled state with opacity classes instead. */}
        <Button
          type="button"
          onClick={handleStart}
          className={`w-full font-semibold ${
            name.trim()
              ? 'bg-amber-400 text-black hover:bg-amber-300'
              : 'bg-amber-400/40 text-black/40 cursor-not-allowed'
          }`}
        >
          Start
        </Button>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- src/__tests__/components/NameEntry.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/NameEntry.tsx src/__tests__/components/NameEntry.test.tsx
git commit -m "feat: add NameEntry component with iOS-safe button handling"
```

---

### Task 8: OutOfFilm Component (TDD)

**Files:**
- Create: `src/components/OutOfFilm.tsx`
- Create: `src/__tests__/components/OutOfFilm.test.tsx`

- [ ] **Step 1: Create the test file**

```typescript
import { render, screen } from '@testing-library/react';
import { OutOfFilm } from '@/components/OutOfFilm';

describe('OutOfFilm', () => {
  it('renders out-of-film message', () => {
    render(<OutOfFilm />);
    expect(screen.getByText(/out of film/i)).toBeInTheDocument();
    expect(screen.getByText(/thanks for capturing/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Create src/components/OutOfFilm.tsx**

```tsx
import { Card, CardContent } from '@/components/ui/card';

export function OutOfFilm() {
  return (
    <Card className="w-full max-w-sm text-center">
      <CardContent className="pt-10 pb-10 space-y-4">
        <p className="text-6xl">🎞</p>
        <h1 className="text-2xl font-bold">You&apos;re out of film!</h1>
        <p className="text-muted-foreground">Thanks for capturing your POV 🎞</p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/components/OutOfFilm.tsx src/__tests__/components/OutOfFilm.test.tsx
git commit -m "feat: add OutOfFilm component"
```

---

### Task 9: CameraCapture Component (TDD)

**Files:**
- Create: `src/components/CameraCapture.tsx`
- Create: `src/__tests__/components/CameraCapture.test.tsx`

> **jsdom note:** `URL.createObjectURL` is not available in jsdom. Add `global.URL.createObjectURL = jest.fn(() => 'blob:mock-url')` in the test file.
>
> **XHR error handling:** `xhr.onerror` fires for network/CORS errors (status 0). `xhr.onload` fires for real HTTP responses including 4xx. Capture `xhr.responseText` in `onload` to show Google's error message.

- [ ] **Step 1: Create the test file**

Create `src/__tests__/components/CameraCapture.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CameraCapture } from '@/components/CameraCapture';

// jsdom does not implement URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');

describe('CameraCapture', () => {
  it('renders greeting with shots remaining', () => {
    render(<CameraCapture guestName="Cyriel" shotsRemaining={25} onUploadSuccess={jest.fn()} />);
    expect(screen.getByText(/Cyriel/)).toBeInTheDocument();
    expect(screen.getByText(/25 shots/i)).toBeInTheDocument();
  });

  it('renders Take Photo and Record Video buttons', () => {
    render(<CameraCapture guestName="Cyriel" shotsRemaining={25} onUploadSuccess={jest.fn()} />);
    expect(screen.getByRole('button', { name: /take photo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record video/i })).toBeInTheDocument();
  });

  it('shows error when video file exceeds 100MB', async () => {
    render(<CameraCapture guestName="Cyriel" shotsRemaining={25} onUploadSuccess={jest.fn()} />);

    const videoInput = document.querySelector('input[accept="video/*"]') as HTMLInputElement;
    const bigFile = new File(['x'], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(bigFile, 'size', { value: 101 * 1024 * 1024 });

    await userEvent.upload(videoInput, bigFile);

    expect(screen.getByText(/video too large/i)).toBeInTheDocument();
  });

  it('shows Upload and Retake buttons after a valid file is selected', async () => {
    render(<CameraCapture guestName="Cyriel" shotsRemaining={25} onUploadSuccess={jest.fn()} />);

    const photoInput = document.querySelector('input[accept="image/*"]') as HTMLInputElement;
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });

    await userEvent.upload(photoInput, file);

    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retake/i })).toBeInTheDocument();
  });

  it('calls onUploadSuccess after successful upload', async () => {
    const onUploadSuccess = jest.fn();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ uploadUrl: 'https://upload.googleapis.com/mock', folderId: 'f1' }),
    }) as jest.Mock;

    const mockXhr = {
      open: jest.fn(),
      setRequestHeader: jest.fn(),
      send: jest.fn().mockImplementation(function (this: typeof mockXhr) {
        if (this.onload) this.onload({} as ProgressEvent);
      }),
      upload: { onprogress: null as unknown as (e: ProgressEvent) => void },
      onload: null as unknown as (e: ProgressEvent) => void,
      onerror: null as unknown as (e: ProgressEvent) => void,
      status: 200,
      responseText: '',
    };
    jest.spyOn(window, 'XMLHttpRequest').mockImplementation(() => mockXhr as unknown as XMLHttpRequest);

    render(<CameraCapture guestName="Cyriel" shotsRemaining={25} onUploadSuccess={onUploadSuccess} />);

    const photoInput = document.querySelector('input[accept="image/*"]') as HTMLInputElement;
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(photoInput, file);
    await userEvent.click(screen.getByRole('button', { name: /upload/i }));

    await waitFor(() => expect(onUploadSuccess).toHaveBeenCalled());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Create src/components/CameraCapture.tsx**

```tsx
'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

interface Props {
  guestName: string;
  shotsRemaining: number;
  onUploadSuccess: () => void;
}

type UploadStatus = 'idle' | 'uploading' | 'error';

export function CameraCapture({ guestName, shotsRemaining, onUploadSuccess }: Props) {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith('video/') && file.size > MAX_VIDEO_SIZE) {
      setError('Video too large — try a shorter clip');
      return;
    }

    setError(null);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const getFileName = (file: File): string => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = file.name.split('.').pop() ?? (file.type.startsWith('image/') ? 'jpg' : 'mp4');
    const prefix = file.type.startsWith('image/') ? 'photo' : 'video';
    return `${prefix}-${ts}.${ext}`;
  };

  const upload = (file: File): Promise<void> =>
    new Promise((resolve, reject) => {
      const fileName = getFileName(file);

      fetch('/api/upload-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestName, fileName, mimeType: file.type, fileSize: file.size }),
      })
        .then((res) => {
          if (!res.ok)
            return res.json().then((b) => Promise.reject(new Error(b.error ?? 'Failed to get upload URL')));
          return res.json();
        })
        .then(({ uploadUrl }: { uploadUrl: string }) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('Content-Type', file.type);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            if (xhr.status < 300) resolve();
            else {
              const detail = xhr.responseText ? `: ${xhr.responseText.slice(0, 200)}` : '';
              reject(new Error(`Upload failed (${xhr.status})${detail}`));
            }
          };
          // onerror fires for network errors and CORS failures (status 0)
          xhr.onerror = () => reject(new Error('Upload failed — network error'));
          xhr.send(file);
        })
        .catch((err: Error) => reject(err));
    });

  const handleUpload = async () => {
    if (!pendingFile) return;
    setUploadStatus('uploading');
    setProgress(0);
    setError(null);

    try {
      await upload(pendingFile);
      setPreviewUrl(null);
      setPendingFile(null);
      setUploadStatus('idle');
      onUploadSuccess();
    } catch (err) {
      setUploadStatus('error');
      setError(err instanceof Error ? err.message : 'Upload failed — tap to retry');
    }
  };

  const handleRetake = () => {
    setPendingFile(null);
    setPreviewUrl(null);
    setError(null);
    setUploadStatus('idle');
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="pb-1 pt-4">
        <p className="text-base font-semibold text-amber-400">
          Hi {guestName}! 🎞 {shotsRemaining} shots left
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!pendingFile && (
          <div className="flex flex-col gap-3">
            <Button
              onClick={() => photoInputRef.current?.click()}
              className="w-full bg-amber-400 text-black hover:bg-amber-300 font-semibold h-12 text-base"
            >
              📷 Take Photo
            </Button>
            <Button
              onClick={() => videoInputRef.current?.click()}
              variant="outline"
              className="w-full h-auto py-2 flex flex-col font-semibold"
            >
              <span className="text-base">🎥 Record Video</span>
              <span className="text-xs font-normal opacity-60">Keep it under 60 seconds</span>
            </Button>
            <input ref={photoInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileChange} className="hidden" />
            <input ref={videoInputRef} type="file" accept="video/*" capture="environment" onChange={handleFileChange} className="hidden" />
          </div>
        )}

        {previewUrl && pendingFile && (
          <div className="space-y-3">
            {pendingFile.type.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Preview" className="w-full rounded-lg max-h-[60vh] object-cover" />
            ) : (
              <video src={previewUrl} controls playsInline className="w-full rounded-lg max-h-[60vh]" />
            )}
            <div className="flex gap-3">
              <Button
                onClick={handleUpload}
                disabled={uploadStatus === 'uploading'}
                className="flex-1 bg-amber-400 text-black hover:bg-amber-300 font-semibold"
              >
                {uploadStatus === 'uploading' ? `Uploading… ${progress}%` : 'Upload'}
              </Button>
              <Button onClick={handleRetake} variant="outline">Retake</Button>
            </div>
          </div>
        )}

        {uploadStatus === 'uploading' && <Progress value={progress} className="h-2" />}
        {error && <p className="text-destructive text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/components/CameraCapture.tsx src/__tests__/components/CameraCapture.test.tsx
git commit -m "feat: add CameraCapture component with direct Drive upload"
```

---

### Task 10: Wire Up Main Page + Layout

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Replace src/app/page.tsx**

```tsx
'use client';

import { useGuestSession } from '@/lib/use-guest-session';
import { NameEntry } from '@/components/NameEntry';
import { CameraCapture } from '@/components/CameraCapture';
import { OutOfFilm } from '@/components/OutOfFilm';

export default function Home() {
  const { guestName, shotsRemaining, isOutOfFilm, setGuestName, incrementShot } = useGuestSession();

  if (!guestName) return <NameEntry onSubmit={setGuestName} />;
  if (isOutOfFilm) return <OutOfFilm />;
  return (
    <CameraCapture
      guestName={guestName}
      shotsRemaining={shotsRemaining}
      onUploadSuccess={incrementShot}
    />
  );
}
```

- [ ] **Step 2: Replace src/app/layout.tsx**

```tsx
import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Geist } from 'next/font/google';
import { cn } from '@/lib/utils';

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: '327 Photo Dump',
  description: 'Capture your wedding POV',
};

// Export viewport separately — do not put width/initialScale in metadata.
// Without this, mobile browsers render at desktop scale and touch targets misalign.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn('dark font-sans', geist.variable)}>
      <body className="bg-background text-foreground min-h-screen flex justify-center items-start pt-6 px-4">
        {children}
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/layout.tsx
git commit -m "feat: wire up main page with viewport fix for mobile"
```

---

### Task 11: Debug Route

**Files:**
- Create: `src/app/api/debug/route.ts`

> Remove this route before sharing the app publicly — it exposes auth diagnostics.

- [ ] **Step 1: Create src/app/api/debug/route.ts**

```typescript
import { NextResponse } from 'next/server';
import { google } from 'googleapis';

function makeAuth() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    'urn:ietf:wg:oauth:2.0:oob',
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN! });
  return oauth2Client;
}

export async function GET() {
  const results: Record<string, string> = {};

  results.hasClientId = !!process.env.GOOGLE_CLIENT_ID ? 'yes' : 'MISSING';
  results.hasClientSecret = !!process.env.GOOGLE_CLIENT_SECRET ? 'yes' : 'MISSING';
  results.hasRefreshToken = !!process.env.GOOGLE_REFRESH_TOKEN ? 'yes' : 'MISSING';
  results.hasFolderId = !!process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ? 'yes' : 'MISSING';

  try {
    const { token } = await makeAuth().getAccessToken();
    results.auth = token ? 'ok' : 'FAILED — no token returned';
  } catch (e) {
    results.auth = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
    return NextResponse.json(results);
  }

  try {
    const drive = google.drive({ version: 'v3', auth: makeAuth() });
    const res = await drive.files.get({ fileId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID! });
    results.folderRead = `ok — found: ${res.data.name}`;
  } catch (e) {
    results.folderRead = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  try {
    const drive = google.drive({ version: 'v3', auth: makeAuth() });
    const created = await drive.files.create({
      requestBody: { name: '__debug_write_test__', mimeType: 'application/vnd.google-apps.folder', parents: [process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!] },
      fields: 'id',
    });
    await drive.files.delete({ fileId: created.data.id! });
    results.writeAccess = 'ok — created and deleted a test folder';
  } catch (e) {
    results.writeAccess = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json(results);
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/debug/route.ts
git commit -m "feat: add debug route for auth diagnostics"
```

---

### Task 12: Google Cloud + Vercel Deploy

**Files:** no code changes — configuration only

- [ ] **Step 1: Set up Google Cloud OAuth2**

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Enable the **Google Drive API**: APIs & Services → Enable APIs → "Google Drive API"
3. Create an OAuth2 Client ID: Credentials → Create Credentials → OAuth client ID → Web application
4. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI
5. Note the **Client ID** and **Client Secret**

- [ ] **Step 2: Add yourself as a test user**

APIs & Services → OAuth consent screen → Test users → Add your own Gmail address.  
(Required because the app is unverified. Without this you get `403: access_denied` in the OAuth flow.)

- [ ] **Step 3: Get a refresh token via OAuth Playground**

1. Go to [https://developers.google.com/oauthplayground](https://developers.google.com/oauthplayground)
2. Gear icon → check "Use your own OAuth credentials" → paste Client ID + Client Secret
3. Select scope: `https://www.googleapis.com/auth/drive`
4. Click **Authorize APIs** → sign in with the Google account that owns the Drive folder
5. Click **Exchange authorization code for tokens**
6. Copy the **Refresh token**

- [ ] **Step 4: Get the root folder ID**

In Google Drive, open the folder that will hold all guest photos. Copy the folder ID from the URL:  
`https://drive.google.com/drive/folders/THIS_IS_THE_FOLDER_ID`

- [ ] **Step 5: Set Vercel environment variables**

```bash
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
vercel env add GOOGLE_REFRESH_TOKEN
vercel env add GOOGLE_DRIVE_ROOT_FOLDER_ID
```

Select **Production** for each.

- [ ] **Step 6: Deploy to Vercel**

```bash
vercel --prod
```

- [ ] **Step 7: Verify with the debug route**

Open `https://your-app.vercel.app/api/debug`. All values should show `ok`.

- [ ] **Step 8: Test end-to-end on a real phone**

Open the app URL, enter a name, capture a photo, upload. Confirm the file appears in the root Drive folder under the guest's subfolder.

- [ ] **Step 9: Generate QR code**

Take the Vercel URL (e.g. `https://327photodump.vercel.app`) and generate a QR code for printing at the venue.

- [ ] **Step 10: Final commit**

```bash
git add .
git commit -m "chore: finalize deployment"
```

---

## Lessons Learned

These issues were hit during development and are already handled in the code above:

| Issue | Root Cause | Fix |
|---|---|---|
| 403 on file upload | Service accounts have no Drive storage quota | Switch to OAuth2 with owner's refresh token |
| "Network error" on upload | CORS not enabled on resumable session URI | Forward client `Origin` header when creating the session |
| `access_denied` in OAuth flow | App unverified, user not in test list | Add your own email as a test user in OAuth consent screen |
| Start button not clickable on iOS | iOS drops taps near `disabled` buttons | Remove `disabled`; use Tailwind opacity classes |
| Button click refreshes page on iOS | `<form>` submit behavior | Remove `<form>`; use `type="button"` + `onClick` |
| Keyboard pushes button off-screen | `autoFocus` on the input | Remove `autoFocus` |
| LAN access breaks interactivity | Next.js 15+ blocks cross-origin dev requests | `allowedDevOrigins: ['*']` in next.config.ts |
| Touch coordinates misalign on mobile | Missing viewport meta tag | Export `viewport` from layout.tsx |
| localStorage crash in Safari Private | Safari throws on localStorage access | try/catch with in-memory fallback |
| `@/` imports fail in Jest | `next/jest` doesn't auto-map tsconfig paths | Explicit `moduleNameMapper` in jest.config.js |

---

## Summary

| Task | Deliverable |
|---|---|
| 1 | Next.js project scaffolded with shadcn/ui |
| 2 | Jest configured with `@/` alias mapping |
| 3 | Shared TypeScript types |
| 4 | `src/lib/google-drive.ts` + tests (OAuth2, CORS-aware) |
| 5 | `src/app/api/upload-session/route.ts` + tests |
| 6 | `src/lib/use-guest-session.ts` + tests (Safari-safe) |
| 7 | `src/components/NameEntry.tsx` + tests (iOS-safe) |
| 8 | `src/components/OutOfFilm.tsx` + tests |
| 9 | `src/components/CameraCapture.tsx` + tests |
| 10 | `src/app/page.tsx` + layout with viewport fix |
| 11 | Debug route for auth diagnostics |
| 12 | Google Cloud OAuth2 setup + Vercel deploy |
