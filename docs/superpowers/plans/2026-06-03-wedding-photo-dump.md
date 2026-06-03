# Wedding Photo Dump Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-first Next.js web app that lets wedding guests capture and upload photos/videos (up to 30 each) directly to a shared Google Drive folder, organized by guest name.

**Architecture:** One Next.js 14 App Router page with one API route. The API route authenticates with Google Drive via a service account and returns a resumable upload URL. The client uploads files directly to Google Drive using that URL — bypassing Vercel's 4.5MB serverless body size limit. Shot count is tracked in localStorage (30-shot disposable camera limit).

**Tech Stack:** Next.js 14, TypeScript, `googleapis` npm package, Google Drive API v3 (resumable uploads), Jest + React Testing Library, Vercel

---

## File Map

| File | Responsibility |
|---|---|
| `app/page.tsx` | Orchestrates the three app states (name entry → camera → out of film) |
| `app/layout.tsx` | Root layout with page metadata |
| `app/globals.css` | Mobile-first dark theme styles |
| `app/api/upload-session/route.ts` | POST: creates/finds guest Drive folder, returns resumable upload URL |
| `components/NameEntry.tsx` | Name input form — first screen |
| `components/CameraCapture.tsx` | Capture buttons, preview, progress bar, upload logic |
| `components/OutOfFilm.tsx` | End-of-shots screen |
| `lib/google-drive.ts` | Service account auth, folder lookup/creation, resumable session init |
| `lib/use-guest-session.ts` | Custom hook: guest name + shot count via localStorage |
| `types/index.ts` | Shared TypeScript interfaces |
| `jest.config.js` | Jest configuration using Next.js transformer |
| `jest.setup.ts` | Jest setup: imports @testing-library/jest-dom |
| `__tests__/lib/google-drive.test.ts` | Unit tests for Drive lib |
| `__tests__/api/upload-session.test.ts` | Unit tests for API route |
| `__tests__/lib/use-guest-session.test.ts` | Unit tests for session hook |
| `__tests__/components/NameEntry.test.tsx` | Component tests |
| `__tests__/components/CameraCapture.test.tsx` | Component tests |
| `__tests__/components/OutOfFilm.test.tsx` | Component tests |
| `.env.example` | Example env vars (committed) |

---

### Task 1: Scaffold the Next.js Project

**Files:**
- Create: all Next.js scaffold files in project root

- [ ] **Step 1: Initialize Next.js project**

Run from `/Users/cyrielbasilio/Sites/327photodump`:

```bash
npx create-next-app@latest . --typescript --app --no-tailwind --no-src-dir --import-alias "@/*" --no-eslint
```

When prompted "Would you like to use Turbopack?" → No.

Expected: Next.js project files created in current directory.

- [ ] **Step 2: Initialize git and commit scaffold**

```bash
git init
git add .
git commit -m "chore: scaffold Next.js 14 project"
```

---

### Task 2: Install Dependencies and Configure Jest

**Files:**
- Modify: `package.json`
- Create: `jest.config.js`
- Create: `jest.setup.ts`
- Create: `.env.example`

- [ ] **Step 1: Install production dependency**

```bash
npm install googleapis
```

- [ ] **Step 2: Install test dependencies**

```bash
npm install --save-dev jest jest-environment-jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/jest
```

- [ ] **Step 3: Add test scripts to package.json**

In `package.json`, update the `"scripts"` block:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "test": "jest",
  "test:watch": "jest --watch"
}
```

- [ ] **Step 4: Create jest.config.js**

```js
const nextJest = require('next/jest');
const createJestConfig = nextJest({ dir: './' });
module.exports = createJestConfig({
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testEnvironment: 'jest-environment-jsdom',
});
```

- [ ] **Step 5: Create jest.setup.ts**

```typescript
import '@testing-library/jest-dom';
```

- [ ] **Step 6: Create .env.example**

```
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...","client_email":"...","private_key":"..."}
GOOGLE_DRIVE_ROOT_FOLDER_ID=1abc123yourFolderIdHere
```

- [ ] **Step 7: Ensure .env.local is gitignored**

In `.gitignore`, confirm this line exists (add it if not):

```
.env.local
```

- [ ] **Step 8: Run tests to verify Jest is working**

```bash
npm test -- --passWithNoTests
```

Expected: Jest runs and exits with 0 failures.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "chore: add googleapis, configure Jest"
```

---

### Task 3: Define Shared TypeScript Types

**Files:**
- Create: `types/index.ts`

- [ ] **Step 1: Create types/index.ts**

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

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add types/index.ts
git commit -m "chore: add shared TypeScript types"
```

---

### Task 4: Google Drive Library (TDD)

**Files:**
- Create: `lib/google-drive.ts`
- Create: `__tests__/lib/google-drive.test.ts`

- [ ] **Step 1: Create the test file**

Create `__tests__/lib/google-drive.test.ts`:

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
      JWT: jest.fn().mockImplementation(() => ({
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
  process.env.GOOGLE_SERVICE_ACCOUNT_KEY = JSON.stringify({
    client_email: 'test@test.iam.gserviceaccount.com',
    private_key: '-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----',
  });
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
      headers: {
        get: (h: string) => (h === 'Location' ? 'https://upload.googleapis.com/upload-url' : null),
      },
    }) as jest.Mock;

    const result = await createResumableUploadSession(
      'folder-id',
      'photo-2026-06-03.jpg',
      'image/jpeg',
      1024000
    );

    expect(result).toBe('https://upload.googleapis.com/upload-url');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('uploadType=resumable'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('throws when Drive does not return a Location header', async () => {
    mockGetAccessToken.mockResolvedValue({ token: 'mock-access-token' });
    global.fetch = jest.fn().mockResolvedValue({
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
npm test -- __tests__/lib/google-drive.test.ts
```

Expected: FAIL — "Cannot find module '@/lib/google-drive'"

- [ ] **Step 3: Create lib/google-drive.ts**

```typescript
import { google } from 'googleapis';

function getAuth() {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!);
  return new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
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
): Promise<string> {
  const auth = getAuth();
  const { token } = await auth.getAccessToken();

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(fileSize),
      },
      body: JSON.stringify({
        name: fileName,
        parents: [folderId],
      }),
    }
  );

  const uploadUrl = response.headers.get('Location');
  if (!uploadUrl) throw new Error('Failed to get upload URL from Google Drive');
  return uploadUrl;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- __tests__/lib/google-drive.test.ts
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/google-drive.ts __tests__/lib/google-drive.test.ts
git commit -m "feat: add Google Drive lib"
```

---

### Task 5: Upload Session API Route (TDD)

**Files:**
- Create: `app/api/upload-session/route.ts`
- Create: `__tests__/api/upload-session.test.ts`

- [ ] **Step 1: Create the test file**

Create `__tests__/api/upload-session.test.ts`:

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
    headers: { 'Content-Type': 'application/json' },
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
npm test -- __tests__/api/upload-session.test.ts
```

Expected: FAIL — "Cannot find module '@/app/api/upload-session/route'"

- [ ] **Step 3: Create app/api/upload-session/route.ts**

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

    const folderId = await findOrCreateGuestFolder(guestName);
    const uploadUrl = await createResumableUploadSession(folderId, fileName, mimeType, fileSize);

    const response: UploadSessionResponse = { uploadUrl, folderId };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Upload session error:', error);
    return NextResponse.json({ error: 'Failed to create upload session' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- __tests__/api/upload-session.test.ts
```

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/api/upload-session/route.ts __tests__/api/upload-session.test.ts
git commit -m "feat: add upload-session API route"
```

---

### Task 6: useGuestSession Hook (TDD)

**Files:**
- Create: `lib/use-guest-session.ts`
- Create: `__tests__/lib/use-guest-session.test.ts`

- [ ] **Step 1: Create the test file**

Create `__tests__/lib/use-guest-session.test.ts`:

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
npm test -- __tests__/lib/use-guest-session.test.ts
```

Expected: FAIL — "Cannot find module '@/lib/use-guest-session'"

- [ ] **Step 3: Create lib/use-guest-session.ts**

```typescript
'use client';

import { useState, useEffect } from 'react';

const MAX_SHOTS = 30;

export function useGuestSession() {
  const [guestName, setGuestNameState] = useState<string | null>(null);
  const [shotCount, setShotCount] = useState(0);

  useEffect(() => {
    const storedName = localStorage.getItem('guestName');
    if (storedName) {
      const count = parseInt(localStorage.getItem(`shotCount_${storedName}`) ?? '0', 10);
      setGuestNameState(storedName);
      setShotCount(count);
    }
  }, []);

  const setGuestName = (name: string) => {
    localStorage.setItem('guestName', name);
    const count = parseInt(localStorage.getItem(`shotCount_${name}`) ?? '0', 10);
    setGuestNameState(name);
    setShotCount(count);
  };

  const incrementShot = () => {
    if (!guestName) return;
    const newCount = shotCount + 1;
    localStorage.setItem(`shotCount_${guestName}`, String(newCount));
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
npm test -- __tests__/lib/use-guest-session.test.ts
```

Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add lib/use-guest-session.ts __tests__/lib/use-guest-session.test.ts
git commit -m "feat: add useGuestSession hook with localStorage tracking"
```

---

### Task 7: NameEntry Component (TDD)

**Files:**
- Create: `components/NameEntry.tsx`
- Create: `__tests__/components/NameEntry.test.tsx`

- [ ] **Step 1: Create the test file**

Create `__tests__/components/NameEntry.test.tsx`:

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NameEntry } from '@/components/NameEntry';

describe('NameEntry', () => {
  it('renders name input and start button', () => {
    render(<NameEntry onSubmit={jest.fn()} />);
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start/i })).toBeInTheDocument();
  });

  it('calls onSubmit with trimmed name when form is submitted', async () => {
    const onSubmit = jest.fn();
    render(<NameEntry onSubmit={onSubmit} />);

    await userEvent.type(screen.getByLabelText(/name/i), '  Cyriel  ');
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
npm test -- __tests__/components/NameEntry.test.tsx
```

Expected: FAIL — "Cannot find module '@/components/NameEntry'"

- [ ] **Step 3: Create components/NameEntry.tsx**

```tsx
'use client';

import { useState } from 'react';

interface Props {
  onSubmit: (name: string) => void;
}

export function NameEntry({ onSubmit }: Props) {
  const [name, setName] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <form onSubmit={handleSubmit} className="name-entry">
      <h1>327 Photo Dump</h1>
      <p className="subtitle">Capture your wedding POV</p>
      <label htmlFor="name">What&apos;s your name?</label>
      <input
        id="name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name or nickname"
        autoFocus
      />
      <button type="submit" disabled={!name.trim()}>
        Start
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- __tests__/components/NameEntry.test.tsx
```

Expected: PASS — 3 tests passing.

- [ ] **Step 5: Commit**

```bash
git add components/NameEntry.tsx __tests__/components/NameEntry.test.tsx
git commit -m "feat: add NameEntry component"
```

---

### Task 8: OutOfFilm Component (TDD)

**Files:**
- Create: `components/OutOfFilm.tsx`
- Create: `__tests__/components/OutOfFilm.test.tsx`

- [ ] **Step 1: Create the test file**

Create `__tests__/components/OutOfFilm.test.tsx`:

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

```bash
npm test -- __tests__/components/OutOfFilm.test.tsx
```

Expected: FAIL — "Cannot find module '@/components/OutOfFilm'"

- [ ] **Step 3: Create components/OutOfFilm.tsx**

```tsx
export function OutOfFilm() {
  return (
    <div className="out-of-film">
      <p className="film-emoji">🎞</p>
      <h1>You&apos;re out of film!</h1>
      <p>Thanks for capturing your POV 🎞</p>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- __tests__/components/OutOfFilm.test.tsx
```

Expected: PASS — 1 test passing.

- [ ] **Step 5: Commit**

```bash
git add components/OutOfFilm.tsx __tests__/components/OutOfFilm.test.tsx
git commit -m "feat: add OutOfFilm component"
```

---

### Task 9: CameraCapture Component (TDD)

**Files:**
- Create: `components/CameraCapture.tsx`
- Create: `__tests__/components/CameraCapture.test.tsx`

- [ ] **Step 1: Create the test file**

Create `__tests__/components/CameraCapture.test.tsx`:

```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CameraCapture } from '@/components/CameraCapture';

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
      json: () =>
        Promise.resolve({ uploadUrl: 'https://upload.googleapis.com/mock', folderId: 'f1' }),
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
    };
    jest
      .spyOn(window, 'XMLHttpRequest')
      .mockImplementation(() => mockXhr as unknown as XMLHttpRequest);

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

```bash
npm test -- __tests__/components/CameraCapture.test.tsx
```

Expected: FAIL — "Cannot find module '@/components/CameraCapture'"

- [ ] **Step 3: Create components/CameraCapture.tsx**

```tsx
'use client';

import { useState, useRef } from 'react';

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
          if (!res.ok) return res.json().then((b) => Promise.reject(new Error(b.error ?? 'Failed to get upload URL')));
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
            else reject(new Error(`Upload failed (${xhr.status})`));
          };
          xhr.onerror = () => reject(new Error('Upload failed — tap to retry'));
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
    <div className="camera-capture">
      <p className="shot-counter">
        Hi {guestName}! 🎞 {shotsRemaining} shots left
      </p>

      {!pendingFile && (
        <div className="capture-buttons">
          <button onClick={() => photoInputRef.current?.click()}>Take Photo</button>
          <button onClick={() => videoInputRef.current?.click()}>Record Video</button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            capture="environment"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>
      )}

      {previewUrl && pendingFile && (
        <div className="preview">
          {pendingFile.type.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Preview" />
          ) : (
            <video src={previewUrl} controls playsInline />
          )}
          <div className="preview-actions">
            <button onClick={handleUpload} disabled={uploadStatus === 'uploading'}>
              {uploadStatus === 'uploading' ? `Uploading… ${progress}%` : 'Upload'}
            </button>
            <button onClick={handleRetake}>Retake</button>
          </div>
        </div>
      )}

      {uploadStatus === 'uploading' && <progress value={progress} max={100} />}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- __tests__/components/CameraCapture.test.tsx
```

Expected: PASS — 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add components/CameraCapture.tsx __tests__/components/CameraCapture.test.tsx
git commit -m "feat: add CameraCapture component"
```

---

### Task 10: Wire Up Main Page

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Replace app/page.tsx**

```tsx
'use client';

import { useGuestSession } from '@/lib/use-guest-session';
import { NameEntry } from '@/components/NameEntry';
import { CameraCapture } from '@/components/CameraCapture';
import { OutOfFilm } from '@/components/OutOfFilm';

export default function Home() {
  const { guestName, shotsRemaining, isOutOfFilm, setGuestName, incrementShot } =
    useGuestSession();

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

- [ ] **Step 2: Replace app/layout.tsx**

```tsx
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '327 Photo Dump',
  description: 'Capture your wedding POV',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
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
git add app/page.tsx app/layout.tsx
git commit -m "feat: wire up main page with three app states"
```

---

### Task 11: Mobile-First CSS

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Replace app/globals.css**

```css
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --bg: #111;
  --fg: #f5f5f5;
  --accent: #e8c97e;
  --muted: #888;
  --radius: 12px;
  --gap: 16px;
}

html, body {
  height: 100%;
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 16px;
  -webkit-font-smoothing: antialiased;
}

body {
  display: flex;
  justify-content: center;
  align-items: flex-start;
  min-height: 100vh;
  padding: 40px var(--gap) var(--gap);
}

/* ── Name Entry ── */
.name-entry {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}

.name-entry h1 {
  font-size: 2rem;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: -0.5px;
}

.name-entry .subtitle {
  color: var(--muted);
  font-size: 0.95rem;
}

.name-entry label {
  font-size: 1.1rem;
  font-weight: 500;
  margin-top: 8px;
}

.name-entry input {
  width: 100%;
  padding: 14px 16px;
  border-radius: var(--radius);
  border: 1.5px solid #333;
  background: #1a1a1a;
  color: var(--fg);
  font-size: 1.1rem;
  outline: none;
  transition: border-color 0.2s;
}

.name-entry input:focus {
  border-color: var(--accent);
}

/* ── Shared Buttons ── */
button {
  padding: 14px 20px;
  border-radius: var(--radius);
  border: none;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
  background: var(--accent);
  color: #111;
}

button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

button:active:not(:disabled) {
  opacity: 0.8;
}

/* ── Camera Capture ── */
.camera-capture {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}

.shot-counter {
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--accent);
}

.capture-buttons {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.preview img,
.preview video {
  width: 100%;
  border-radius: var(--radius);
  max-height: 60vh;
  object-fit: cover;
}

.preview-actions {
  display: flex;
  gap: 12px;
  margin-top: 12px;
}

.preview-actions button:last-child {
  background: #2a2a2a;
  color: var(--fg);
  flex: 0 0 auto;
}

progress {
  width: 100%;
  height: 6px;
  border-radius: 3px;
  appearance: none;
  background: #2a2a2a;
}

progress::-webkit-progress-bar {
  background: #2a2a2a;
  border-radius: 3px;
}

progress::-webkit-progress-value {
  background: var(--accent);
  border-radius: 3px;
}

.error {
  color: #ff6b6b;
  font-size: 0.9rem;
}

/* ── Out of Film ── */
.out-of-film {
  width: 100%;
  max-width: 420px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
  margin-top: 20vh;
}

.film-emoji {
  font-size: 4rem;
}

.out-of-film h1 {
  font-size: 1.8rem;
  font-weight: 700;
}

.out-of-film p:last-child {
  color: var(--muted);
}
```

- [ ] **Step 2: Start dev server and verify on mobile**

```bash
npm run dev
```

Open `http://localhost:3000` in a mobile browser (or use browser DevTools device emulation). Verify:
- Dark background, gold accent color (`#e8c97e`)
- Name entry form is readable and well-spaced
- Buttons are large enough to tap with a thumb

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat: add mobile-first dark theme CSS"
```

---

### Task 12: Google Cloud Setup and Vercel Deploy

**Files:** no code changes — configuration only

- [ ] **Step 1: Create a Google Cloud service account**

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a new project (or use an existing one)
3. Enable the **Google Drive API**: APIs & Services → Enable APIs → search "Google Drive API" → Enable
4. Go to **IAM & Admin → Service Accounts → Create Service Account**
5. Name it `wedding-photo-dump`, click Done
6. Click the new service account → **Keys** tab → Add Key → Create new key → **JSON**
7. Download the JSON key file — keep it safe, don't commit it

- [ ] **Step 2: Share your Drive folder with the service account**

1. Create a folder in Google Drive named "327 Photo Dump" (or any name)
2. Right-click the folder → Share → paste the service account email (e.g. `wedding-photo-dump@your-project.iam.gserviceaccount.com`) → set permission to **Editor** → Share
3. Copy the folder ID from the URL bar: `https://drive.google.com/drive/folders/THIS_IS_THE_FOLDER_ID`

- [ ] **Step 3: Set up local environment**

Create `.env.local` in the project root (not committed):

```
GOOGLE_SERVICE_ACCOUNT_KEY=<paste the entire JSON key file contents, minified to a single line>
GOOGLE_DRIVE_ROOT_FOLDER_ID=<the folder ID from step 2>
```

To minify the JSON to one line (run in terminal):

```bash
cat /path/to/your-key-file.json | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin)))"
```

- [ ] **Step 4: Test locally end-to-end**

```bash
npm run dev
```

Open `http://localhost:3000`, enter a name, take a photo, upload. Verify the file appears in Google Drive under the guest's subfolder.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: All tests pass.

- [ ] **Step 6: Deploy to Vercel**

```bash
npx vercel
```

When prompted for environment variables, add:
- `GOOGLE_SERVICE_ACCOUNT_KEY` — the minified JSON string
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` — the folder ID

Or set them after deploy in the Vercel dashboard: **Project Settings → Environment Variables**, then redeploy.

- [ ] **Step 7: Verify production deploy**

Open the Vercel URL on your phone, upload a test photo, confirm it appears in Drive.

- [ ] **Step 8: Generate QR code for the wedding**

Take the Vercel URL (e.g. `https://327photodump.vercel.app`) and generate a QR code using any QR code generator. Print and place at tables.

- [ ] **Step 9: Final commit**

```bash
git add .
git commit -m "chore: finalize deployment"
```

---

## Summary

| Task | Deliverable |
|---|---|
| 1 | Next.js project scaffolded |
| 2 | Dependencies + Jest configured |
| 3 | Shared TypeScript types |
| 4 | `lib/google-drive.ts` + tests |
| 5 | `app/api/upload-session/route.ts` + tests |
| 6 | `lib/use-guest-session.ts` + tests |
| 7 | `components/NameEntry.tsx` + tests |
| 8 | `components/OutOfFilm.tsx` + tests |
| 9 | `components/CameraCapture.tsx` + tests |
| 10 | `app/page.tsx` wired up |
| 11 | Mobile-first dark theme CSS |
| 12 | Google Cloud + Vercel deploy |
