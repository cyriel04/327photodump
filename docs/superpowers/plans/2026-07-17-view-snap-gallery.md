# View Snap (Gallery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let guests view photos/videos once they run out of film — their own shots in a profile-style grid, and a swipeable feed of every guest's shots.

**Architecture:** The gallery replaces the current "Out of Film" screen. Guest Drive folders are made link-shareable at creation time so the browser loads thumbnails and full-res media directly from Drive — no server proxying. Two new read-only API routes expose per-guest files and an activity-ordered guest list; both the "My Shots" grid and the "Feed" reuse the same per-guest endpoint.

**Tech Stack:** Next.js App Router + TypeScript, Google Drive API v3 (googleapis + OAuth2), Jest + React Testing Library, shadcn/ui + Tailwind.

## Global Constraints

- Gallery is only reachable once `isOutOfFilm` is true (30 shots) — it replaces `OutOfFilm`; the camera flow (States 1–2 in `src/app/page.tsx`) is unchanged.
- No server-side proxying of media bytes. Guest folders get "anyone with the link can view" permission at creation time (once per folder), so `thumbnailLink`/`webContentLink` URLs work directly in `<img>`/`<video>` tags.
- New Drive calls are additive only — do not modify the existing upload flow (`upload-session/route.ts`, direct-to-Drive XHR PUT in `CameraCapture.tsx`).
- Feed orders guests by most recent upload activity, most recent first. "My Shots" and a Feed guest-page both use the same per-guest file-listing function and API route.
- Videos autoplay muted in the lightbox; the guest can tap/swipe to move to the next/previous item.
- Use raw `<img>`/`<video>` tags with `// eslint-disable-next-line @next/next/no-img-element` for Drive URLs — matches the existing pattern in `CameraCapture.tsx` (Drive is a remote, user-controlled domain, not a fit for `next/image`).

---

### Task 1: Fix Drive auth test mock + auto-share guest folders on creation

The existing `google-drive.test.ts` mocks `google.auth.JWT`, but `src/lib/google-drive.ts` actually constructs `google.auth.OAuth2` — 4 of the 6 test suites in the repo currently fail because of this mismatch (`TypeError: _googleapis.google.auth.OAuth2 is not a constructor`). This task fixes that mock (needed before any new Drive-lib tests in this plan can run reliably) and adds the folder-sharing behavior in the same pass, since both changes touch the same mock factory.

**Files:**
- Modify: `src/__tests__/lib/google-drive.test.ts`
- Modify: `src/lib/google-drive.ts:1-37`

**Interfaces:**
- Produces: `setFolderPubliclyViewable(folderId: string): Promise<void>` exported from `src/lib/google-drive.ts`. `findOrCreateGuestFolder` now calls it whenever it creates a new folder (not when an existing folder is found).

- [ ] **Step 1: Replace the mock factory and `beforeEach` block to match the real OAuth2 implementation**

In `src/__tests__/lib/google-drive.test.ts`, replace lines 6–37 (the `jest.mock('googleapis', ...)` call through the end of the `beforeEach` block) with:

```ts
jest.mock('googleapis', () => {
  const filesList = jest.fn();
  const filesCreate = jest.fn();
  const permissionsCreate = jest.fn();
  const getAccessToken = jest.fn();
  const setCredentials = jest.fn();
  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({ getAccessToken, setCredentials })),
      },
      drive: jest.fn().mockReturnValue({
        files: { list: filesList, create: filesCreate },
        permissions: { create: permissionsCreate },
      }),
    },
    __mockFns: { filesList, filesCreate, permissionsCreate, getAccessToken, setCredentials },
  };
});

const { __mockFns } = jest.requireMock('googleapis');
const mockFilesList: jest.Mock = __mockFns.filesList;
const mockFilesCreate: jest.Mock = __mockFns.filesCreate;
const mockPermissionsCreate: jest.Mock = __mockFns.permissionsCreate;
const mockGetAccessToken: jest.Mock = __mockFns.getAccessToken;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root-folder-id';
});
```

- [ ] **Step 2: Run the full suite to confirm the pre-existing failures are fixed**

Run: `npm test -- google-drive.test.ts`
Expected: All existing tests in this file PASS (the 4 `OAuth2 is not a constructor` failures are gone). No new tests yet.

- [ ] **Step 3: Write two failing tests for folder-sharing behavior**

Add this new `describe` block to the end of `src/__tests__/lib/google-drive.test.ts`:

```ts
describe('setFolderPubliclyViewable via findOrCreateGuestFolder', () => {
  it('sets anyone-with-link viewer permission when creating a new folder', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });
    mockFilesCreate.mockResolvedValue({ data: { id: 'new-folder-id' } });

    await findOrCreateGuestFolder('Cyriel');

    expect(mockPermissionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'new-folder-id',
        requestBody: { role: 'reader', type: 'anyone' },
      })
    );
  });

  it('does not set permission when folder already exists', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [{ id: 'existing-folder-id' }] } });

    await findOrCreateGuestFolder('Cyriel');

    expect(mockPermissionsCreate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run tests to verify the two new tests fail**

Run: `npm test -- google-drive.test.ts`
Expected: FAIL — `mockPermissionsCreate` was never called (function doesn't exist / isn't wired in yet).

- [ ] **Step 5: Implement `setFolderPubliclyViewable` and wire it into folder creation**

In `src/lib/google-drive.ts`, add this new function after `findOrCreateGuestFolder` (after line 37):

```ts
export async function setFolderPubliclyViewable(folderId: string): Promise<void> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  await drive.permissions.create({
    fileId: folderId,
    requestBody: { role: 'reader', type: 'anyone' },
  });
}
```

Then update the folder-creation branch inside `findOrCreateGuestFolder` (currently lines 27–36):

```ts
  const folder = await drive.files.create({
    requestBody: {
      name: guestName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [rootFolderId],
    },
    fields: 'id',
  });

  await setFolderPubliclyViewable(folder.data.id!);

  return folder.data.id!;
```

- [ ] **Step 6: Run the full test file to verify everything passes**

Run: `npm test -- google-drive.test.ts`
Expected: PASS — all tests in the file green.

- [ ] **Step 7: Commit**

```bash
git add src/lib/google-drive.ts src/__tests__/lib/google-drive.test.ts
git commit -m "fix: correct Drive auth test mock; auto-share guest folders on creation"
```

---

### Task 2: Add `listGuestFiles` to the Drive library

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/google-drive.ts`
- Modify: `src/__tests__/lib/google-drive.test.ts`

**Interfaces:**
- Consumes: `findOrCreateGuestFolder(guestName: string): Promise<string>` (existing, Task 1).
- Produces: `GalleryFile` type from `src/types`; `listGuestFiles(guestName: string): Promise<GalleryFile[]>` exported from `src/lib/google-drive.ts`, newest-first.

- [ ] **Step 1: Write failing tests for `listGuestFiles`**

Add to `src/__tests__/lib/google-drive.test.ts` (needs `listGuestFiles` added to the import on line 4):

```ts
import { findOrCreateGuestFolder, createResumableUploadSession, listGuestFiles } from '@/lib/google-drive';
```

```ts
describe('listGuestFiles', () => {
  it('returns files in the guest folder, mapped to GalleryFile shape', async () => {
    mockFilesList
      .mockResolvedValueOnce({ data: { files: [{ id: 'folder-1' }] } })
      .mockResolvedValueOnce({
        data: {
          files: [
            {
              id: 'file-1',
              mimeType: 'image/jpeg',
              thumbnailLink: 'https://drive.google.com/thumb/file-1',
              webContentLink: 'https://drive.google.com/uc?id=file-1',
              createdTime: '2026-07-17T20:00:00Z',
            },
          ],
        },
      });

    const result = await listGuestFiles('Cyriel');

    expect(result).toEqual([
      {
        id: 'file-1',
        mimeType: 'image/jpeg',
        thumbnailLink: 'https://drive.google.com/thumb/file-1',
        viewUrl: 'https://drive.google.com/uc?id=file-1',
        createdTime: '2026-07-17T20:00:00Z',
      },
    ]);
  });

  it('returns null thumbnailLink when Drive has not generated one yet', async () => {
    mockFilesList
      .mockResolvedValueOnce({ data: { files: [{ id: 'folder-1' }] } })
      .mockResolvedValueOnce({
        data: {
          files: [
            {
              id: 'file-2',
              mimeType: 'video/mp4',
              webContentLink: 'https://drive.google.com/uc?id=file-2',
              createdTime: '2026-07-17T20:05:00Z',
            },
          ],
        },
      });

    const result = await listGuestFiles('Cyriel');

    expect(result[0].thumbnailLink).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- google-drive.test.ts`
Expected: FAIL — `listGuestFiles` is not exported.

- [ ] **Step 3: Add the `GalleryFile` type**

In `src/types/index.ts`, add:

```ts
export interface GalleryFile {
  id: string;
  mimeType: string;
  thumbnailLink: string | null;
  viewUrl: string;
  createdTime: string;
}
```

- [ ] **Step 4: Implement `listGuestFiles`**

In `src/lib/google-drive.ts`, add at the end of the file, and add `import { GalleryFile } from '@/types';` to the top imports:

```ts
export async function listGuestFiles(guestName: string): Promise<GalleryFile[]> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const folderId = await findOrCreateGuestFolder(guestName);

  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, mimeType, thumbnailLink, webContentLink, createdTime)',
    orderBy: 'createdTime desc',
  });

  return (response.data.files ?? []).map((file) => ({
    id: file.id!,
    mimeType: file.mimeType!,
    thumbnailLink: file.thumbnailLink ?? null,
    viewUrl: file.webContentLink!,
    createdTime: file.createdTime!,
  }));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- google-drive.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/google-drive.ts src/types/index.ts src/__tests__/lib/google-drive.test.ts
git commit -m "feat: add listGuestFiles to Drive library"
```

---

### Task 3: Add `/api/gallery/guest` route

**Files:**
- Create: `src/app/api/gallery/guest/route.ts`
- Create: `src/__tests__/api/gallery-guest.test.ts`

**Interfaces:**
- Consumes: `listGuestFiles(guestName: string): Promise<GalleryFile[]>` (Task 2).
- Produces: `GET` handler at `/api/gallery/guest?guestName=X` returning `{ files: GalleryFile[] }` (200), `{ error }` (400 if missing `guestName`, 500 on Drive failure).

- [ ] **Step 1: Write the failing test file**

Create `src/__tests__/api/gallery-guest.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { GET } from '@/app/api/gallery/guest/route';
import { NextRequest } from 'next/server';

jest.mock('@/lib/google-drive', () => ({
  listGuestFiles: jest.fn(),
}));

import { listGuestFiles } from '@/lib/google-drive';
const mockListGuestFiles = listGuestFiles as jest.Mock;

function makeRequest(query: string) {
  return new NextRequest(`http://localhost/api/gallery/guest${query}`);
}

describe('GET /api/gallery/guest', () => {
  it('returns 400 when guestName is missing', async () => {
    const res = await GET(makeRequest(''));
    expect(res.status).toBe(400);
  });

  it('returns files for the given guest', async () => {
    mockListGuestFiles.mockResolvedValue([
      {
        id: 'file-1',
        mimeType: 'image/jpeg',
        thumbnailLink: null,
        viewUrl: 'https://x',
        createdTime: '2026-07-17T20:00:00Z',
      },
    ]);

    const res = await GET(makeRequest('?guestName=Cyriel'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.files).toHaveLength(1);
    expect(mockListGuestFiles).toHaveBeenCalledWith('Cyriel');
  });

  it('returns 500 when listGuestFiles throws', async () => {
    mockListGuestFiles.mockRejectedValue(new Error('Drive error'));

    const res = await GET(makeRequest('?guestName=Cyriel'));

    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- gallery-guest.test.ts`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/gallery/guest/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { listGuestFiles } from '@/lib/google-drive';

export async function GET(request: NextRequest) {
  const guestName = request.nextUrl.searchParams.get('guestName');

  if (!guestName) {
    return NextResponse.json({ error: 'Missing guestName' }, { status: 400 });
  }

  try {
    const files = await listGuestFiles(guestName);
    return NextResponse.json({ files });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Gallery guest error:', message);
    return NextResponse.json({ error: 'Failed to load guest files', detail: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- gallery-guest.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/gallery/guest/route.ts src/__tests__/api/gallery-guest.test.ts
git commit -m "feat: add /api/gallery/guest route"
```

---

### Task 4: Add `listGuestsByActivity` to the Drive library

Drive's API has no "descendant of" recursive query, so this uses two calls: list the guest folders under root, then a single `files.list` call scoped to those folder IDs via an OR'd `q` clause, ordered by `createdTime desc`, taking the first (most recent) file seen per folder. Folder ID batches are chunked at 100 to stay well under Drive's query-length limits.

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/google-drive.ts`
- Modify: `src/__tests__/lib/google-drive.test.ts`

**Interfaces:**
- Produces: `GalleryFeedEntry` type from `src/types`; `listGuestsByActivity(): Promise<GalleryFeedEntry[]>` exported from `src/lib/google-drive.ts`, sorted most-recent-first.

- [ ] **Step 1: Write failing tests for `listGuestsByActivity`**

Add `listGuestsByActivity` to the import on line 4 of `src/__tests__/lib/google-drive.test.ts`, then add:

```ts
describe('listGuestsByActivity', () => {
  it('returns guests ordered by most recent upload, most recent first', async () => {
    mockFilesList
      .mockResolvedValueOnce({
        data: {
          files: [
            { id: 'folder-a', name: 'Sarah' },
            { id: 'folder-b', name: 'Mike' },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          files: [
            { parents: ['folder-b'], thumbnailLink: 'https://thumb-b', createdTime: '2026-07-17T20:10:00Z' },
            { parents: ['folder-a'], thumbnailLink: 'https://thumb-a', createdTime: '2026-07-17T20:05:00Z' },
          ],
        },
      });

    const result = await listGuestsByActivity();

    expect(result).toEqual([
      { guestName: 'Mike', coverThumbnail: 'https://thumb-b', mostRecentTime: '2026-07-17T20:10:00Z' },
      { guestName: 'Sarah', coverThumbnail: 'https://thumb-a', mostRecentTime: '2026-07-17T20:05:00Z' },
    ]);
  });

  it('returns an empty array when no guest folders exist', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [] } });

    const result = await listGuestsByActivity();

    expect(result).toEqual([]);
  });

  it('skips guest folders with no uploaded files', async () => {
    mockFilesList
      .mockResolvedValueOnce({
        data: {
          files: [
            { id: 'folder-a', name: 'Sarah' },
            { id: 'folder-c', name: 'EmptyGuest' },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          files: [{ parents: ['folder-a'], thumbnailLink: 'https://thumb-a', createdTime: '2026-07-17T20:05:00Z' }],
        },
      });

    const result = await listGuestsByActivity();

    expect(result).toEqual([
      { guestName: 'Sarah', coverThumbnail: 'https://thumb-a', mostRecentTime: '2026-07-17T20:05:00Z' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- google-drive.test.ts`
Expected: FAIL — `listGuestsByActivity` is not exported.

- [ ] **Step 3: Add the `GalleryFeedEntry` type**

In `src/types/index.ts`, add:

```ts
export interface GalleryFeedEntry {
  guestName: string;
  coverThumbnail: string | null;
  mostRecentTime: string;
}
```

- [ ] **Step 4: Implement `listGuestsByActivity`**

In `src/lib/google-drive.ts`, add `GalleryFeedEntry` to the `@/types` import, then add at the end of the file:

```ts
const FOLDER_CHUNK_SIZE = 100;

export async function listGuestsByActivity(): Promise<GalleryFeedEntry[]> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;

  const foldersResponse = await drive.files.list({
    q: `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
  });
  const folders = foldersResponse.data.files ?? [];
  if (folders.length === 0) return [];

  const folderNameById = new Map(folders.map((f) => [f.id!, f.name!]));
  const mostRecentByFolder = new Map<string, { thumbnailLink: string | null; createdTime: string }>();

  for (let i = 0; i < folders.length; i += FOLDER_CHUNK_SIZE) {
    const chunk = folders.slice(i, i + FOLDER_CHUNK_SIZE);
    const q = chunk.map((f) => `'${f.id}' in parents`).join(' or ');
    const filesResponse = await drive.files.list({
      q: `(${q}) and trashed=false`,
      fields: 'files(parents, thumbnailLink, createdTime)',
      orderBy: 'createdTime desc',
      pageSize: 1000,
    });

    for (const file of filesResponse.data.files ?? []) {
      const folderId = file.parents?.[0];
      if (!folderId || mostRecentByFolder.has(folderId)) continue;
      mostRecentByFolder.set(folderId, {
        thumbnailLink: file.thumbnailLink ?? null,
        createdTime: file.createdTime!,
      });
    }
  }

  return Array.from(mostRecentByFolder.entries())
    .map(([folderId, info]) => ({
      guestName: folderNameById.get(folderId)!,
      coverThumbnail: info.thumbnailLink,
      mostRecentTime: info.createdTime,
    }))
    .sort((a, b) => (a.mostRecentTime < b.mostRecentTime ? 1 : -1));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- google-drive.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/google-drive.ts src/types/index.ts src/__tests__/lib/google-drive.test.ts
git commit -m "feat: add listGuestsByActivity to Drive library"
```

---

### Task 5: Add `/api/gallery/feed` route

**Files:**
- Create: `src/app/api/gallery/feed/route.ts`
- Create: `src/__tests__/api/gallery-feed.test.ts`

**Interfaces:**
- Consumes: `listGuestsByActivity(): Promise<GalleryFeedEntry[]>` (Task 4).
- Produces: `GET` handler at `/api/gallery/feed` returning `{ guests: GalleryFeedEntry[] }` (200) or `{ error }` (500 on Drive failure).

- [ ] **Step 1: Write the failing test file**

Create `src/__tests__/api/gallery-feed.test.ts`:

```ts
/**
 * @jest-environment node
 */
import { GET } from '@/app/api/gallery/feed/route';

jest.mock('@/lib/google-drive', () => ({
  listGuestsByActivity: jest.fn(),
}));

import { listGuestsByActivity } from '@/lib/google-drive';
const mockListGuestsByActivity = listGuestsByActivity as jest.Mock;

describe('GET /api/gallery/feed', () => {
  it('returns guests from listGuestsByActivity', async () => {
    mockListGuestsByActivity.mockResolvedValue([
      { guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' },
    ]);

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.guests).toHaveLength(1);
  });

  it('returns 500 when listGuestsByActivity throws', async () => {
    mockListGuestsByActivity.mockRejectedValue(new Error('Drive error'));

    const res = await GET();

    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- gallery-feed.test.ts`
Expected: FAIL — route file doesn't exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/gallery/feed/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { listGuestsByActivity } from '@/lib/google-drive';

export async function GET() {
  try {
    const guests = await listGuestsByActivity();
    return NextResponse.json({ guests });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Gallery feed error:', message);
    return NextResponse.json({ error: 'Failed to load feed', detail: message }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- gallery-feed.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/gallery/feed/route.ts src/__tests__/api/gallery-feed.test.ts
git commit -m "feat: add /api/gallery/feed route"
```

---

### Task 6: Build the `Lightbox` component

**Files:**
- Create: `src/components/Lightbox.tsx`
- Create: `src/__tests__/components/Lightbox.test.tsx`

**Interfaces:**
- Consumes: `GalleryFile` type (Task 2).
- Produces: `Lightbox({ files: GalleryFile[], startIndex: number, onClose: () => void })` — full-screen viewer used by `MyShotsGrid` (Task 7) and `FeedScreen` (Task 8).

- [ ] **Step 1: Write the failing test file**

Create `src/__tests__/components/Lightbox.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Lightbox } from '@/components/Lightbox';
import { GalleryFile } from '@/types';

const files: GalleryFile[] = [
  { id: 'file-1', mimeType: 'image/jpeg', thumbnailLink: null, viewUrl: 'https://drive/1', createdTime: '2026-07-17T20:00:00Z' },
  { id: 'file-2', mimeType: 'video/mp4', thumbnailLink: null, viewUrl: 'https://drive/2', createdTime: '2026-07-17T20:05:00Z' },
];

describe('Lightbox', () => {
  it('renders the file at startIndex', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://drive/1');
  });

  it('advances to the next file on next tap', async () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    await userEvent.click(screen.getByLabelText('Next'));
    const video = document.querySelector('video');
    expect(video).toHaveAttribute('src', 'https://drive/2');
  });

  it('renders video with autoplay and muted attributes', () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    const video = document.querySelector('video');
    expect(video).toHaveAttribute('autoplay');
    expect(video).toHaveAttribute('muted');
  });

  it('calls onClose when the close button is tapped', async () => {
    const onClose = jest.fn();
    render(<Lightbox files={files} startIndex={0} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('hides the prev button on the first file', () => {
    render(<Lightbox files={files} startIndex={0} onClose={jest.fn()} />);
    expect(screen.queryByLabelText('Previous')).not.toBeInTheDocument();
  });

  it('hides the next button on the last file', () => {
    render(<Lightbox files={files} startIndex={1} onClose={jest.fn()} />);
    expect(screen.queryByLabelText('Next')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- Lightbox.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the component**

Create `src/components/Lightbox.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { GalleryFile } from '@/types';

interface Props {
  files: GalleryFile[];
  startIndex: number;
  onClose: () => void;
}

export function Lightbox({ files, startIndex, onClose }: Props) {
  const [index, setIndex] = useState(startIndex);
  const file = files[index];

  const goNext = () => setIndex((i) => Math.min(i + 1, files.length - 1));
  const goPrev = () => setIndex((i) => Math.max(i - 1, 0));

  if (!file) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      <button onClick={onClose} aria-label="Close" className="absolute top-4 right-4 text-white text-2xl">
        ✕
      </button>

      {index > 0 && (
        <button onClick={goPrev} aria-label="Previous" className="absolute left-2 text-white text-3xl">
          ‹
        </button>
      )}
      {index < files.length - 1 && (
        <button onClick={goNext} aria-label="Next" className="absolute right-2 text-white text-3xl">
          ›
        </button>
      )}

      {file.mimeType.startsWith('video/') ? (
        <video
          key={file.id}
          src={file.viewUrl}
          autoPlay
          muted
          playsInline
          controls
          className="max-h-full max-w-full"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={file.id} src={file.viewUrl} alt="" className="max-h-full max-w-full object-contain" />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- Lightbox.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/Lightbox.tsx src/__tests__/components/Lightbox.test.tsx
git commit -m "feat: add Lightbox component"
```

---

### Task 7: Build the `MyShotsGrid` component

**Files:**
- Create: `src/components/MyShotsGrid.tsx`
- Create: `src/__tests__/components/MyShotsGrid.test.tsx`

**Interfaces:**
- Consumes: `GET /api/gallery/guest?guestName=X` (Task 3), `Lightbox` (Task 6).
- Produces: `MyShotsGrid({ guestName: string })` — used by `Gallery` (Task 9).

- [ ] **Step 1: Write the failing test file**

Create `src/__tests__/components/MyShotsGrid.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MyShotsGrid } from '@/components/MyShotsGrid';

function mockFetchOnce(body: unknown, ok = true) {
  global.fetch = jest.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(body),
  }) as jest.Mock;
}

describe('MyShotsGrid', () => {
  it('shows a loading state before files arrive', () => {
    mockFetchOnce({ files: [] });
    render(<MyShotsGrid guestName="Cyriel" />);
    expect(screen.getByText(/loading your shots/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no files', async () => {
    mockFetchOnce({ files: [] });
    render(<MyShotsGrid guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText(/no shots synced yet/i)).toBeInTheDocument());
  });

  it('shows an error state when the fetch fails', async () => {
    mockFetchOnce({ error: 'boom' }, false);
    render(<MyShotsGrid guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText(/couldn't load your shots/i)).toBeInTheDocument());
  });

  it('renders a thumbnail per file and opens the lightbox on tap', async () => {
    mockFetchOnce({
      files: [
        {
          id: 'file-1',
          mimeType: 'image/jpeg',
          thumbnailLink: 'https://thumb-1',
          viewUrl: 'https://view-1',
          createdTime: '2026-07-17T20:00:00Z',
        },
      ],
    });
    render(<MyShotsGrid guestName="Cyriel" />);

    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button'));

    expect(document.querySelector('.fixed.inset-0')).toBeInTheDocument();
  });

  it('shows a placeholder icon when thumbnailLink is missing', async () => {
    mockFetchOnce({
      files: [
        {
          id: 'file-2',
          mimeType: 'video/mp4',
          thumbnailLink: null,
          viewUrl: 'https://view-2',
          createdTime: '2026-07-17T20:00:00Z',
        },
      ],
    });
    render(<MyShotsGrid guestName="Cyriel" />);
    await waitFor(() => expect(screen.getByText('🎥')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- MyShotsGrid.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the component**

Create `src/components/MyShotsGrid.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { GalleryFile } from '@/types';
import { Lightbox } from '@/components/Lightbox';

interface Props {
  guestName: string;
}

type Status = 'loading' | 'ready' | 'error';

export function MyShotsGrid({ guestName }: Props) {
  const [status, setStatus] = useState<Status>('loading');
  const [files, setFiles] = useState<GalleryFile[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');

    fetch(`/api/gallery/guest?guestName=${encodeURIComponent(guestName)}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load shots');
        return res.json();
      })
      .then((body: { files: GalleryFile[] }) => {
        if (cancelled) return;
        setFiles(body.files);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, [guestName]);

  if (status === 'loading') return <p className="text-sm text-muted-foreground">Loading your shots…</p>;
  if (status === 'error') return <p className="text-sm text-destructive">Couldn&apos;t load your shots.</p>;
  if (files.length === 0) return <p className="text-sm text-muted-foreground">No shots synced yet.</p>;

  return (
    <>
      <div className="grid grid-cols-3 gap-1">
        {files.map((file, i) => (
          <button key={file.id} onClick={() => setOpenIndex(i)} className="aspect-square bg-muted overflow-hidden">
            {file.thumbnailLink ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={file.thumbnailLink} alt="" className="w-full h-full object-cover" />
            ) : (
              <span className="flex items-center justify-center w-full h-full text-2xl">
                {file.mimeType.startsWith('video/') ? '🎥' : '📷'}
              </span>
            )}
          </button>
        ))}
      </div>

      {openIndex !== null && (
        <Lightbox files={files} startIndex={openIndex} onClose={() => setOpenIndex(null)} />
      )}
    </>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- MyShotsGrid.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/MyShotsGrid.tsx src/__tests__/components/MyShotsGrid.test.tsx
git commit -m "feat: add MyShotsGrid component"
```

---

### Task 8: Build the `FeedScreen` component

Guests are navigated one at a time (index-based state), driven by Prev/Next buttons and a horizontal swipe gesture — not native scroll-snap — so navigation is deterministic and testable. Each guest's files are fetched lazily via the same `/api/gallery/guest` endpoint the first time their page becomes active, then cached in memory for the rest of the session.

**Files:**
- Create: `src/components/FeedScreen.tsx`
- Create: `src/__tests__/components/FeedScreen.test.tsx`

**Interfaces:**
- Consumes: `GET /api/gallery/feed` (Task 5), `GET /api/gallery/guest?guestName=X` (Task 3), `Lightbox` (Task 6).
- Produces: `FeedScreen()` (no props) — used by `Gallery` (Task 9).

- [ ] **Step 1: Write the failing test file**

Create `src/__tests__/components/FeedScreen.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeedScreen } from '@/components/FeedScreen';

function mockFetchSequence(responses: unknown[]) {
  let call = 0;
  global.fetch = jest.fn().mockImplementation(() => {
    const body = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  }) as jest.Mock;
}

describe('FeedScreen', () => {
  it('shows an empty state when no guests have uploaded', async () => {
    mockFetchSequence([{ guests: [] }]);
    render(<FeedScreen />);
    await waitFor(() => expect(screen.getByText(/no shots from other guests/i)).toBeInTheDocument());
  });

  it('shows the first guest and their shots after loading', async () => {
    mockFetchSequence([
      { guests: [{ guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' }] },
      {
        files: [
          {
            id: 'file-1',
            mimeType: 'image/jpeg',
            thumbnailLink: 'https://thumb-1',
            viewUrl: 'https://view-1',
            createdTime: '2026-07-17T20:00:00Z',
          },
        ],
      },
    ]);
    render(<FeedScreen />);
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());
  });

  it('advances to the next guest and lazily loads their shots', async () => {
    mockFetchSequence([
      {
        guests: [
          { guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:10:00Z' },
          { guestName: 'Mike', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' },
        ],
      },
      { files: [] },
      {
        files: [
          {
            id: 'file-2',
            mimeType: 'video/mp4',
            thumbnailLink: null,
            viewUrl: 'https://view-2',
            createdTime: '2026-07-17T20:00:00Z',
          },
        ],
      },
    ]);
    render(<FeedScreen />);
    await waitFor(() => expect(screen.getByText('Sarah')).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText('Next guest'));

    await waitFor(() => expect(screen.getByText('Mike')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('🎥')).toBeInTheDocument());
  });

  it('opens the lightbox when a thumbnail is tapped', async () => {
    mockFetchSequence([
      { guests: [{ guestName: 'Sarah', coverThumbnail: null, mostRecentTime: '2026-07-17T20:00:00Z' }] },
      {
        files: [
          {
            id: 'file-1',
            mimeType: 'image/jpeg',
            thumbnailLink: 'https://thumb-1',
            viewUrl: 'https://view-1',
            createdTime: '2026-07-17T20:00:00Z',
          },
        ],
      },
    ]);
    render(<FeedScreen />);
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());

    const thumbnailButton = screen.getAllByRole('button').find((b) => b.querySelector('img'))!;
    await userEvent.click(thumbnailButton);

    expect(document.querySelector('.fixed.inset-0')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- FeedScreen.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the component**

Create `src/components/FeedScreen.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { GalleryFile, GalleryFeedEntry } from '@/types';
import { Lightbox } from '@/components/Lightbox';

type FeedStatus = 'loading' | 'ready' | 'error' | 'empty';

export function FeedScreen() {
  const [status, setStatus] = useState<FeedStatus>('loading');
  const [guests, setGuests] = useState<GalleryFeedEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [filesByGuest, setFilesByGuest] = useState<Record<string, GalleryFile[]>>({});
  const [guestFilesLoading, setGuestFilesLoading] = useState(false);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  useEffect(() => {
    fetch('/api/gallery/feed')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load feed');
        return res.json();
      })
      .then((body: { guests: GalleryFeedEntry[] }) => {
        setGuests(body.guests);
        setStatus(body.guests.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => setStatus('error'));
  }, []);

  const activeGuest = guests[activeIndex];

  useEffect(() => {
    if (!activeGuest || filesByGuest[activeGuest.guestName]) return;

    setGuestFilesLoading(true);
    fetch(`/api/gallery/guest?guestName=${encodeURIComponent(activeGuest.guestName)}`)
      .then((res) => res.json())
      .then((body: { files: GalleryFile[] }) => {
        setFilesByGuest((prev) => ({ ...prev, [activeGuest.guestName]: body.files }));
      })
      .finally(() => setGuestFilesLoading(false));
  }, [activeGuest, filesByGuest]);

  const goNext = () => setActiveIndex((i) => Math.min(i + 1, guests.length - 1));
  const goPrev = () => setActiveIndex((i) => Math.max(i - 1, 0));

  const handleTouchStart = (e: React.TouchEvent) => setTouchStartX(e.touches[0].clientX);
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX;
    if (delta < -50) goNext();
    if (delta > 50) goPrev();
    setTouchStartX(null);
  };

  if (status === 'loading') return <p className="text-sm text-muted-foreground">Loading feed…</p>;
  if (status === 'error') return <p className="text-sm text-destructive">Couldn&apos;t load the feed.</p>;
  if (status === 'empty') return <p className="text-sm text-muted-foreground">No shots from other guests yet.</p>;

  const activeFiles = activeGuest ? filesByGuest[activeGuest.guestName] ?? [] : [];

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="flex items-center justify-between mb-2">
        <button onClick={goPrev} disabled={activeIndex === 0} aria-label="Previous guest">
          ‹
        </button>
        <p className="font-semibold">{activeGuest?.guestName}</p>
        <button onClick={goNext} disabled={activeIndex === guests.length - 1} aria-label="Next guest">
          ›
        </button>
      </div>

      {guestFilesLoading && !filesByGuest[activeGuest.guestName] ? (
        <p className="text-sm text-muted-foreground">Loading shots…</p>
      ) : (
        <div className="flex gap-1 overflow-x-auto">
          {activeFiles.map((file, i) => (
            <button
              key={file.id}
              onClick={() => setOpenIndex(i)}
              className="shrink-0 w-24 h-24 bg-muted overflow-hidden"
            >
              {file.thumbnailLink ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={file.thumbnailLink} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="flex items-center justify-center w-full h-full text-2xl">
                  {file.mimeType.startsWith('video/') ? '🎥' : '📷'}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {openIndex !== null && (
        <Lightbox files={activeFiles} startIndex={openIndex} onClose={() => setOpenIndex(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- FeedScreen.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/FeedScreen.tsx src/__tests__/components/FeedScreen.test.tsx
git commit -m "feat: add FeedScreen component"
```

---

### Task 9: Build `Gallery`, wire it into the app, retire `OutOfFilm`

**Files:**
- Create: `src/components/Gallery.tsx`
- Create: `src/__tests__/components/Gallery.test.tsx`
- Modify: `src/app/page.tsx`
- Delete: `src/components/OutOfFilm.tsx`
- Delete: `src/__tests__/components/OutOfFilm.test.tsx`

**Interfaces:**
- Consumes: `MyShotsGrid` (Task 7), `FeedScreen` (Task 8).
- Produces: `Gallery({ guestName: string })` — rendered from `src/app/page.tsx` in place of `OutOfFilm`.

- [ ] **Step 1: Write the failing test file**

Create `src/__tests__/components/Gallery.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Gallery } from '@/components/Gallery';

jest.mock('@/components/MyShotsGrid', () => ({
  MyShotsGrid: ({ guestName }: { guestName: string }) => <div>MyShotsGrid for {guestName}</div>,
}));
jest.mock('@/components/FeedScreen', () => ({
  FeedScreen: () => <div>FeedScreen</div>,
}));

describe('Gallery', () => {
  it('renders the out-of-film message', () => {
    render(<Gallery guestName="Cyriel" />);
    expect(screen.getByText(/out of film/i)).toBeInTheDocument();
  });

  it('shows My Shots by default', () => {
    render(<Gallery guestName="Cyriel" />);
    expect(screen.getByText(/MyShotsGrid for Cyriel/)).toBeInTheDocument();
  });

  it('switches to Feed when the Feed tab is tapped', async () => {
    render(<Gallery guestName="Cyriel" />);
    await userEvent.click(screen.getByRole('button', { name: 'Feed' }));
    expect(screen.getByText('FeedScreen')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- Gallery.test.tsx`
Expected: FAIL — component doesn't exist.

- [ ] **Step 3: Implement the component**

Create `src/components/Gallery.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { MyShotsGrid } from '@/components/MyShotsGrid';
import { FeedScreen } from '@/components/FeedScreen';

interface Props {
  guestName: string;
}

type Tab = 'mine' | 'feed';

export function Gallery({ guestName }: Props) {
  const [tab, setTab] = useState<Tab>('mine');

  return (
    <div className="w-full max-w-sm space-y-3">
      <div className="text-center space-y-1">
        <p className="text-4xl">🎞</p>
        <h1 className="text-xl font-bold">You&apos;re out of film!</h1>
        <p className="text-muted-foreground text-sm">Thanks for capturing your POV 🎞</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setTab('mine')}
          className={tab === 'mine' ? 'font-semibold underline' : 'text-muted-foreground'}
        >
          My Shots
        </button>
        <button
          onClick={() => setTab('feed')}
          className={tab === 'feed' ? 'font-semibold underline' : 'text-muted-foreground'}
        >
          Feed
        </button>
      </div>

      {tab === 'mine' ? <MyShotsGrid guestName={guestName} /> : <FeedScreen />}
    </div>
  );
}
```

- [ ] **Step 4: Run the Gallery test file to verify it passes**

Run: `npm test -- Gallery.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire `Gallery` into `page.tsx` and remove `OutOfFilm`**

Replace the full contents of `src/app/page.tsx`:

```tsx
'use client';

import { useGuestSession } from '@/lib/use-guest-session';
import { NameEntry } from '@/components/NameEntry';
import { CameraCapture } from '@/components/CameraCapture';
import { Gallery } from '@/components/Gallery';

export default function Home() {
  const { guestName, shotsRemaining, isOutOfFilm, setGuestName, incrementShot } =
    useGuestSession();

  if (!guestName) return <NameEntry onSubmit={setGuestName} />;
  if (isOutOfFilm) return <Gallery guestName={guestName} />;
  return (
    <CameraCapture
      guestName={guestName}
      shotsRemaining={shotsRemaining}
      onUploadSuccess={incrementShot}
    />
  );
}
```

Then delete the now-unused files:

```bash
rm src/components/OutOfFilm.tsx src/__tests__/components/OutOfFilm.test.tsx
```

- [ ] **Step 6: Run the full test suite and the production build**

Run: `npm test`
Expected: PASS — all suites green, no reference to `OutOfFilm` remains.

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add Gallery view, replace OutOfFilm screen"
```

---

## Summary

| Task | Deliverable |
|---|---|
| 1 | Fixed Drive auth test mock; guest folders auto-shared on creation |
| 2 | `listGuestFiles` in Drive library |
| 3 | `/api/gallery/guest` route |
| 4 | `listGuestsByActivity` in Drive library |
| 5 | `/api/gallery/feed` route |
| 6 | `Lightbox` component |
| 7 | `MyShotsGrid` component |
| 8 | `FeedScreen` component |
| 9 | `Gallery` component, wired into `page.tsx`, `OutOfFilm` retired |
