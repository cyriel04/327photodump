/**
 * @jest-environment node
 */
import {
  escapeDriveQueryValue,
  findGuestFolder,
  findOrCreateGuestFolder,
  createResumableUploadSession,
  listGuestFiles,
  listGuestsByActivity,
  isDriveFileId,
  fetchGuestVideo,
  clearGuestVideoCache,
  getAuth,
  resetAuthClient,
} from '@/lib/google-drive';

// Mock functions are created inside the factory to avoid hoisting issues.
// We expose them on __mockFns so tests can access them via jest.requireMock.
jest.mock('googleapis', () => {
  const filesList = jest.fn();
  const filesCreate = jest.fn();
  const filesDelete = jest.fn();
  const filesUpdate = jest.fn();
  const filesGet = jest.fn();
  const permissionsCreate = jest.fn();
  const getAccessToken = jest.fn();
  const refreshAccessToken = jest.fn();
  const setCredentials = jest.fn();
  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({ getAccessToken, refreshAccessToken, setCredentials })),
      },
      drive: jest.fn().mockReturnValue({
        files: { list: filesList, create: filesCreate, delete: filesDelete, update: filesUpdate, get: filesGet },
        permissions: { create: permissionsCreate },
      }),
    },
    __mockFns: { filesGet, filesList, filesCreate, filesDelete, filesUpdate, permissionsCreate, getAccessToken, refreshAccessToken, setCredentials },
  };
});

const { __mockFns } = jest.requireMock('googleapis');
const mockFilesList: jest.Mock = __mockFns.filesList;
const mockFilesCreate: jest.Mock = __mockFns.filesCreate;
const mockFilesDelete: jest.Mock = __mockFns.filesDelete;
const mockFilesUpdate: jest.Mock = __mockFns.filesUpdate;
const mockPermissionsCreate: jest.Mock = __mockFns.permissionsCreate;
const mockGetAccessToken: jest.Mock = __mockFns.getAccessToken;
const mockFilesGet: jest.Mock = __mockFns.filesGet;
const mockSetCredentials: jest.Mock = __mockFns.setCredentials;
const mockRefreshAccessToken: jest.Mock = __mockFns.refreshAccessToken;
const { google: mockGoogle } = jest.requireMock('googleapis');
const mockOAuth2: jest.Mock = mockGoogle.auth.OAuth2;

// Many tests replace global.fetch; put the real one back so nothing leaks
// between tests or into other suites sharing this worker.
const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root-folder-id';
});

describe('getAuth', () => {
  beforeEach(() => {
    resetAuthClient();
  });

  it('reuses one OAuth2 client across calls so the access token cache survives', () => {
    const first = getAuth();
    const second = getAuth();

    expect(second).toBe(first);
    expect(mockOAuth2).toHaveBeenCalledTimes(1);
    expect(mockOAuth2).toHaveBeenCalledWith('test-client-id', 'test-client-secret', 'urn:ietf:wg:oauth:2.0:oob');
    expect(mockSetCredentials).toHaveBeenCalledTimes(1);
    expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: 'test-refresh-token' });
  });

  it('builds a new client when the credentials in the environment change', () => {
    const first = getAuth();
    process.env.GOOGLE_REFRESH_TOKEN = 'rotated-refresh-token';

    const second = getAuth();

    expect(second).not.toBe(first);
    expect(mockOAuth2).toHaveBeenCalledTimes(2);
    expect(mockSetCredentials).toHaveBeenLastCalledWith({ refresh_token: 'rotated-refresh-token' });
  });

  it('builds a new client after resetAuthClient', () => {
    const first = getAuth();
    resetAuthClient();
    expect(getAuth()).not.toBe(first);
    expect(mockOAuth2).toHaveBeenCalledTimes(2);
  });

  it('shares the client across Drive helpers and video range requests', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });
    mockGetAccessToken.mockResolvedValue({ token: 'access-token' });
    mockFilesGet.mockImplementation(async ({ fileId }: { fileId: string }) =>
      fileId === 'guest-folder'
        ? { data: { mimeType: 'application/vnd.google-apps.folder', parents: ['root-folder-id'], trashed: false } }
        : { data: { mimeType: 'video/mp4', parents: ['guest-folder'], trashed: false } },
    );
    global.fetch = jest.fn().mockResolvedValue(new Response('ab', { status: 206 }));
    clearGuestVideoCache();

    await findGuestFolder('Cyriel');
    await listGuestFiles('Cyriel');
    await fetchGuestVideo('video-id-123', 'bytes=0-1');
    await fetchGuestVideo('video-id-123', 'bytes=2-99');

    expect(mockOAuth2).toHaveBeenCalledTimes(1);
    mockFilesGet.mockReset();
  });
});

describe('escapeDriveQueryValue', () => {
  it('leaves plain names unchanged', () => {
    expect(escapeDriveQueryValue('Cyriel')).toBe('Cyriel');
  });

  it('escapes single quotes with a backslash', () => {
    expect(escapeDriveQueryValue("O'Brien")).toBe("O\\'Brien");
  });

  it('escapes backslashes before quotes so an escape cannot be neutralised', () => {
    expect(escapeDriveQueryValue("a\\' or name contains '")).toBe("a\\\\\\' or name contains \\'");
  });
});

describe('findGuestFolder', () => {
  it('returns the folder id when it exists', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [{ id: 'existing-folder-id' }] } });

    await expect(findGuestFolder('Cyriel')).resolves.toBe('existing-folder-id');
  });

  it('returns null and never creates a folder when none exists', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });

    await expect(findGuestFolder('Nobody')).resolves.toBeNull();
    expect(mockFilesCreate).not.toHaveBeenCalled();
    expect(mockPermissionsCreate).not.toHaveBeenCalled();
  });

  it("escapes a quote in the guest name inside the Drive query", async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });

    await findGuestFolder("O'Brien");

    const { q } = mockFilesList.mock.calls[0][0];
    expect(q).toContain("name='O\\'Brien'");
    expect(q).not.toContain("name='O'Brien'");
  });
});

describe('findGuestFolder ordering', () => {
  it('orders by createdTime (oldest first) so the same folder always wins', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [{ id: 'oldest-folder-id' }] } });

    await findGuestFolder('Cyriel');

    expect(mockFilesList.mock.calls[0][0]).toEqual(
      expect.objectContaining({ orderBy: 'createdTime', pageSize: 1 })
    );
  });
});

describe('findOrCreateGuestFolder permission failure', () => {
  it('trashes (never hard-deletes) the just-created folder and rethrows when permissions.create fails', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });
    mockFilesCreate.mockResolvedValue({ data: { id: 'new-folder-id' } });
    mockPermissionsCreate.mockRejectedValueOnce(new Error('permission denied'));
    mockFilesUpdate.mockResolvedValue({});

    await expect(findOrCreateGuestFolder('Cyriel')).rejects.toThrow('permission denied');
    expect(mockFilesUpdate).toHaveBeenCalledWith({ fileId: 'new-folder-id', requestBody: { trashed: true } });
    expect(mockFilesDelete).not.toHaveBeenCalled();
  });

  it('still rethrows the permission error and logs when the cleanup trash also fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFilesList.mockResolvedValue({ data: { files: [] } });
    mockFilesCreate.mockResolvedValue({ data: { id: 'new-folder-id' } });
    mockPermissionsCreate.mockRejectedValueOnce(new Error('permission denied'));
    mockFilesUpdate.mockRejectedValueOnce(new Error('trash failed'));

    await expect(findOrCreateGuestFolder("O'Brien")).rejects.toThrow('permission denied');
    expect(mockFilesUpdate).toHaveBeenCalledWith({ fileId: 'new-folder-id', requestBody: { trashed: true } });
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('trash failed');
    expect(logged).not.toContain('test-refresh-token');
    expect(logged).not.toContain('test-client-secret');
    expect(logged).not.toContain('root-folder-id');
    errorSpy.mockRestore();
  });

  it('does not trash or delete anything when the permission succeeds', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });
    mockFilesCreate.mockResolvedValue({ data: { id: 'new-folder-id' } });
    mockPermissionsCreate.mockResolvedValue({});

    await findOrCreateGuestFolder('Cyriel');

    expect(mockFilesDelete).not.toHaveBeenCalled();
    expect(mockFilesUpdate).not.toHaveBeenCalled();
  });
});

describe('findOrCreateGuestFolder', () => {
  it("escapes a quote in the guest name but creates the folder with the raw name", async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });
    mockFilesCreate.mockResolvedValue({ data: { id: 'new-folder-id' } });

    await findOrCreateGuestFolder("O'Brien");

    expect(mockFilesList.mock.calls[0][0].q).toContain("name='O\\'Brien'");
    expect(mockFilesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ requestBody: expect.objectContaining({ name: "O'Brien" }) })
    );
  });

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

  it('returns [] and does not create a folder when the guest has no folder', async () => {
    mockFilesList.mockResolvedValueOnce({ data: { files: [] } });

    const result = await listGuestFiles('Stranger');

    expect(result).toEqual([]);
    expect(mockFilesList).toHaveBeenCalledTimes(1);
    expect(mockFilesCreate).not.toHaveBeenCalled();
    expect(mockPermissionsCreate).not.toHaveBeenCalled();
  });

  it('requests an explicit pageSize for the guest file listing', async () => {
    mockFilesList
      .mockResolvedValueOnce({ data: { files: [{ id: 'folder-1' }] } })
      .mockResolvedValueOnce({ data: { files: [] } });

    await listGuestFiles('Cyriel');

    expect(mockFilesList.mock.calls[1][0]).toEqual(expect.objectContaining({ pageSize: 100 }));
  });
});

describe('listGuestFiles across duplicate folders and pages', () => {
  const file = (id: string, parent: string, createdTime: string) => ({
    id,
    parents: [parent],
    mimeType: 'image/jpeg',
    thumbnailLink: `https://thumb/${id}`,
    webContentLink: `https://drive.google.com/uc?id=${id}`,
    createdTime,
  });

  it('lists every same-name folder under the root with an escaped name', async () => {
    mockFilesList
      .mockResolvedValueOnce({ data: { files: [{ id: 'folder-1' }, { id: 'folder-2' }] } })
      .mockResolvedValueOnce({ data: { files: [] } });

    await listGuestFiles("O'Brien");

    const folderQuery = mockFilesList.mock.calls[0][0];
    expect(folderQuery.q).toContain("name='O\\'Brien'");
    expect(folderQuery.q).toContain("'root-folder-id' in parents");
    expect(folderQuery.pageSize).toBeGreaterThan(1);
    expect(folderQuery.fields).toContain('nextPageToken');
  });

  it('queries files in all same-name folders with one batched list, newest first', async () => {
    mockFilesList
      .mockResolvedValueOnce({ data: { files: [{ id: 'folder-1' }, { id: 'folder-2' }] } })
      .mockResolvedValueOnce({
        data: {
          files: [
            file('f-new', 'folder-2', '2026-07-17T21:00:00Z'),
            file('f-old', 'folder-1', '2026-07-17T20:00:00Z'),
          ],
        },
      });

    const result = await listGuestFiles('Cyriel');

    expect(mockFilesList).toHaveBeenCalledTimes(2);
    const { q, orderBy } = mockFilesList.mock.calls[1][0];
    expect(q).toContain("'folder-1' in parents or 'folder-2' in parents");
    expect(orderBy).toBe('createdTime desc');
    expect(result.map((f) => f.id)).toEqual(['f-new', 'f-old']);
  });

  it('follows nextPageToken so guests with more than one page of files lose nothing', async () => {
    mockFilesList
      .mockResolvedValueOnce({ data: { files: [{ id: 'folder-1' }] } })
      .mockResolvedValueOnce({
        data: { files: [file('f-2', 'folder-1', '2026-07-17T21:00:00Z')], nextPageToken: 'page-2' },
      })
      .mockResolvedValueOnce({ data: { files: [file('f-1', 'folder-1', '2026-07-17T20:00:00Z')] } });

    const result = await listGuestFiles('Cyriel');

    expect(mockFilesList.mock.calls[2][0]).toEqual(expect.objectContaining({ pageToken: 'page-2' }));
    expect(result.map((f) => f.id)).toEqual(['f-2', 'f-1']);
  });

  it('sorts newest first even if pages come back out of order', async () => {
    mockFilesList
      .mockResolvedValueOnce({ data: { files: [{ id: 'folder-1' }] } })
      .mockResolvedValueOnce({
        data: { files: [file('f-old', 'folder-1', '2026-07-17T19:00:00Z')], nextPageToken: 'page-2' },
      })
      .mockResolvedValueOnce({ data: { files: [file('f-new', 'folder-1', '2026-07-17T23:00:00Z')] } });

    const result = await listGuestFiles('Cyriel');

    expect(result.map((f) => f.id)).toEqual(['f-new', 'f-old']);
  });

  it('propagates Drive errors', async () => {
    mockFilesList.mockRejectedValueOnce(new Error('Drive down'));

    await expect(listGuestFiles('Cyriel')).rejects.toThrow('Drive down');
  });
});

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

describe('listGuestsByActivity pagination', () => {
  it('follows nextPageToken on the folder listing and asks for 1000 per page', async () => {
    mockFilesList
      .mockResolvedValueOnce({
        data: { files: [{ id: 'folder-a', name: 'Sarah' }], nextPageToken: 'folders-page-2' },
      })
      .mockResolvedValueOnce({ data: { files: [{ id: 'folder-b', name: 'Mike' }] } })
      .mockResolvedValueOnce({
        data: {
          files: [
            { parents: ['folder-b'], thumbnailLink: 'https://thumb-b', createdTime: '2026-07-17T20:10:00Z' },
            { parents: ['folder-a'], thumbnailLink: 'https://thumb-a', createdTime: '2026-07-17T20:05:00Z' },
          ],
        },
      });

    const result = await listGuestsByActivity();

    expect(mockFilesList.mock.calls[0][0]).toEqual(expect.objectContaining({ pageSize: 1000 }));
    expect(mockFilesList.mock.calls[0][0].pageToken).toBeUndefined();
    expect(mockFilesList.mock.calls[1][0]).toEqual(
      expect.objectContaining({ pageSize: 1000, pageToken: 'folders-page-2' })
    );
    expect(mockFilesList.mock.calls[2][0].q).toContain("'folder-a' in parents");
    expect(mockFilesList.mock.calls[2][0].q).toContain("'folder-b' in parents");
    expect(result.map((g) => g.guestName)).toEqual(['Mike', 'Sarah']);
  });

  it('follows nextPageToken on the files listing so older guests are not dropped', async () => {
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
            { parents: ['folder-b'], thumbnailLink: 'https://thumb-b1', createdTime: '2026-07-17T21:00:00Z' },
            { parents: ['folder-b'], thumbnailLink: 'https://thumb-b2', createdTime: '2026-07-17T20:50:00Z' },
          ],
          nextPageToken: 'files-page-2',
        },
      })
      .mockResolvedValueOnce({
        data: {
          files: [
            { parents: ['folder-b'], thumbnailLink: 'https://thumb-b3', createdTime: '2026-07-17T20:40:00Z' },
            { parents: ['folder-a'], thumbnailLink: 'https://thumb-a', createdTime: '2026-07-17T20:05:00Z' },
          ],
        },
      });

    const result = await listGuestsByActivity();

    expect(mockFilesList.mock.calls[2][0]).toEqual(expect.objectContaining({ pageToken: 'files-page-2' }));
    expect(result).toEqual([
      { guestName: 'Mike', coverThumbnail: 'https://thumb-b1', mostRecentTime: '2026-07-17T21:00:00Z' },
      { guestName: 'Sarah', coverThumbnail: 'https://thumb-a', mostRecentTime: '2026-07-17T20:05:00Z' },
    ]);
  });

  it('follows every files page even when a folder in the chunk is empty', async () => {
    // folder-c has no files (created before its first upload finished), so no
    // early exit is possible: an older guest may only appear on a later page.
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
          nextPageToken: 'files-page-2',
        },
      })
      .mockResolvedValueOnce({ data: { files: [] } });

    const result = await listGuestsByActivity();

    expect(mockFilesList).toHaveBeenCalledTimes(3);
    expect(mockFilesList.mock.calls[2][0]).toEqual(expect.objectContaining({ pageToken: 'files-page-2' }));
    expect(result).toEqual([
      { guestName: 'Sarah', coverThumbnail: 'https://thumb-a', mostRecentTime: '2026-07-17T20:05:00Z' },
    ]);
  });
});

describe('listGuestsByActivity duplicate folder names', () => {
  it('merges same-name folders into one entry with the most recent cover', async () => {
    mockFilesList
      .mockResolvedValueOnce({
        data: {
          files: [
            { id: 'folder-a1', name: 'Sarah' },
            { id: 'folder-a2', name: 'Sarah' },
            { id: 'folder-b', name: 'Mike' },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          files: [
            { parents: ['folder-a2'], thumbnailLink: 'https://thumb-a2', createdTime: '2026-07-17T21:00:00Z' },
            { parents: ['folder-b'], thumbnailLink: 'https://thumb-b', createdTime: '2026-07-17T20:30:00Z' },
            { parents: ['folder-a1'], thumbnailLink: 'https://thumb-a1', createdTime: '2026-07-17T20:00:00Z' },
          ],
        },
      });

    const result = await listGuestsByActivity();

    expect(result).toEqual([
      { guestName: 'Sarah', coverThumbnail: 'https://thumb-a2', mostRecentTime: '2026-07-17T21:00:00Z' },
      { guestName: 'Mike', coverThumbnail: 'https://thumb-b', mostRecentTime: '2026-07-17T20:30:00Z' },
    ]);
  });

  it('merges same-name folders even when their files arrive out of order across pages', async () => {
    mockFilesList
      .mockResolvedValueOnce({
        data: {
          files: [
            { id: 'folder-a1', name: 'Sarah' },
            { id: 'folder-a2', name: 'Sarah' },
          ],
        },
      })
      .mockResolvedValueOnce({
        data: {
          files: [{ parents: ['folder-a1'], thumbnailLink: 'https://old', createdTime: '2026-07-17T20:00:00Z' }],
          nextPageToken: 'p2',
        },
      })
      .mockResolvedValueOnce({
        data: {
          files: [{ parents: ['folder-a2'], thumbnailLink: 'https://new', createdTime: '2026-07-17T22:00:00Z' }],
        },
      });

    const result = await listGuestsByActivity();

    expect(result).toEqual([
      { guestName: 'Sarah', coverThumbnail: 'https://new', mostRecentTime: '2026-07-17T22:00:00Z' },
    ]);
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
      1024000
    );

    expect(result).toBe('https://upload.googleapis.com/upload-url');
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('uploadType=resumable'),
      expect.objectContaining({ method: 'POST' })
    );
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  function sessionResponse(status: number, location: string | null = null) {
    return new Response(status === 200 ? null : 'nope', {
      status,
      headers: location ? { Location: location } : {},
    });
  }

  it('on a 401 refreshes the token and retries once with the same Origin and body', async () => {
    mockGetAccessToken.mockResolvedValue({ token: 'revoked-token' });
    mockRefreshAccessToken.mockResolvedValue({ credentials: { access_token: 'fresh-token' } });
    const mockFetch = jest
      .fn()
      .mockResolvedValueOnce(sessionResponse(401))
      .mockResolvedValueOnce(sessionResponse(200, 'https://upload.googleapis.com/retried'));
    global.fetch = mockFetch;

    const result = await createResumableUploadSession('folder-id', 'p.jpg', 'image/jpeg', 10, 'https://app.example');

    expect(result).toBe('https://upload.googleapis.com/retried');
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [firstUrl, first] = mockFetch.mock.calls[0];
    const [secondUrl, second] = mockFetch.mock.calls[1];
    expect(secondUrl).toBe(firstUrl);
    expect(first.headers.Authorization).toBe('Bearer revoked-token');
    expect(second.headers.Authorization).toBe('Bearer fresh-token');
    expect(second.headers.Origin).toBe('https://app.example');
    expect(second.method).toBe('POST');
    expect(second.body).toBe(first.body);
    expect(JSON.parse(second.body)).toEqual({ name: 'p.jpg', parents: ['folder-id'] });
    expect({ ...second.headers, Authorization: 'x' }).toEqual({ ...first.headers, Authorization: 'x' });
  });

  it('does not retry a second 401 and throws without leaking the token', async () => {
    mockGetAccessToken.mockResolvedValue({ token: 'revoked-token' });
    mockRefreshAccessToken.mockResolvedValue({ credentials: { access_token: 'fresh-token' } });
    const mockFetch = jest.fn().mockImplementation(async () => sessionResponse(401));
    global.fetch = mockFetch;

    const error = await createResumableUploadSession('folder-id', 'p.jpg', 'image/jpeg', 10).catch((e) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('401');
    expect(error.message).not.toContain('fresh-token');
    expect(error.message).not.toContain('revoked-token');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it.each([403, 500])('does not refresh or re-send the POST on a %i', async (status) => {
    mockGetAccessToken.mockResolvedValue({ token: 'access-token' });
    const mockFetch = jest.fn().mockImplementation(async () => sessionResponse(status));
    global.fetch = mockFetch;

    await expect(createResumableUploadSession('folder-id', 'p.jpg', 'image/jpeg', 10)).rejects.toThrow(
      `(${status})`,
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it('does not re-send the POST when the network request itself fails', async () => {
    mockGetAccessToken.mockResolvedValue({ token: 'access-token' });
    const mockFetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));
    global.fetch = mockFetch;

    await expect(createResumableUploadSession('folder-id', 'p.jpg', 'image/jpeg', 10)).rejects.toThrow('fetch failed');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it('propagates a failed refresh (e.g. invalid_grant) without sending a second POST', async () => {
    mockGetAccessToken.mockResolvedValue({ token: 'revoked-token' });
    mockRefreshAccessToken.mockRejectedValue(new Error('invalid_grant'));
    const mockFetch = jest.fn().mockImplementation(async () => sessionResponse(401));
    global.fetch = mockFetch;

    await expect(createResumableUploadSession('folder-id', 'p.jpg', 'image/jpeg', 10)).rejects.toThrow('invalid_grant');
    expect(mockFetch).toHaveBeenCalledTimes(1);
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

describe('isDriveFileId', () => {
  it('accepts a Drive-style id', () => {
    expect(isDriveFileId('1AbC-d_EfGhIjKlMnOp')).toBe(true);
  });

  it('rejects ids with path or query characters', () => {
    expect(isDriveFileId('abc/../secret')).toBe(false);
    expect(isDriveFileId('abcdefghij?x=1')).toBe(false);
    expect(isDriveFileId('short')).toBe(false);
  });
});

describe('fetchGuestVideo', () => {
  const GUEST_FOLDER = {
    data: { mimeType: 'application/vnd.google-apps.folder', parents: ['root-folder-id'], trashed: false },
  };
  const VIDEO = { data: { mimeType: 'video/mp4', parents: ['guest-folder'], trashed: false } };
  const signal = new AbortController().signal;
  let mockFetch: jest.Mock;

  beforeEach(() => {
    clearGuestVideoCache();
    mockGetAccessToken.mockResolvedValue({ token: 'access-token' });
    mockFetch = jest.fn().mockResolvedValue(new Response('ab', { status: 206 }));
    global.fetch = mockFetch;
  });

  async function expectRejected(fileId = 'video-id-123') {
    await expect(fetchGuestVideo(fileId, 'bytes=0-1', signal)).resolves.toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  }

  it('fetches a video in a guest folder directly under the root', async () => {
    mockFilesGet.mockResolvedValueOnce(VIDEO).mockResolvedValueOnce(GUEST_FOLDER);

    const result = await fetchGuestVideo('video-id-123', 'bytes=0-99', signal);

    expect(result?.mimeType).toBe('video/mp4');
    expect(result?.media.status).toBe(206);
    expect(mockFilesGet).toHaveBeenNthCalledWith(1, { fileId: 'video-id-123', fields: 'mimeType, parents, trashed' });
    expect(mockFilesGet).toHaveBeenNthCalledWith(2, { fileId: 'guest-folder', fields: 'mimeType, parents, trashed' });
    expect(mockFetch).toHaveBeenCalledWith('https://www.googleapis.com/drive/v3/files/video-id-123?alt=media', {
      headers: { Authorization: 'Bearer access-token', Range: 'bytes=0-99', 'Accept-Encoding': 'identity' },
      signal,
    });
  });

  it('on a 401 refreshes the token and retries the range request once, keeping the abort signal', async () => {
    mockFilesGet.mockResolvedValueOnce(VIDEO).mockResolvedValueOnce(GUEST_FOLDER);
    mockGetAccessToken.mockResolvedValue({ token: 'revoked-token' });
    mockRefreshAccessToken.mockResolvedValue({ credentials: { access_token: 'fresh-token' } });
    const unauthorized = new Response('unauthorized', { status: 401 });
    mockFetch.mockReset();
    mockFetch.mockResolvedValueOnce(unauthorized).mockResolvedValueOnce(new Response('ab', { status: 206 }));

    const result = await fetchGuestVideo('video-id-123', 'bytes=0-99', signal);

    expect(result?.media.status).toBe(206);
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenNthCalledWith(1, 'https://www.googleapis.com/drive/v3/files/video-id-123?alt=media', {
      headers: { Authorization: 'Bearer revoked-token', Range: 'bytes=0-99', 'Accept-Encoding': 'identity' },
      signal,
    });
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://www.googleapis.com/drive/v3/files/video-id-123?alt=media', {
      headers: { Authorization: 'Bearer fresh-token', Range: 'bytes=0-99', 'Accept-Encoding': 'identity' },
      signal,
    });
    // The discarded 401 body is released rather than left holding the connection.
    expect(unauthorized.bodyUsed || unauthorized.body?.locked).toBeTruthy();
  });

  it('on a 401 reuses a token another request already refreshed instead of exchanging again', async () => {
    mockFilesGet.mockResolvedValueOnce(VIDEO).mockResolvedValueOnce(GUEST_FOLDER);
    resetAuthClient();
    const client = getAuth() as unknown as { credentials?: { access_token?: string } };
    mockGetAccessToken.mockImplementation(async () => {
      // Simulate a concurrent request finishing its refresh after we read the old token.
      client.credentials = { access_token: 'refreshed-elsewhere' };
      return { token: 'revoked-token' };
    });
    mockFetch.mockReset();
    mockFetch
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('ab', { status: 206 }));

    try {
      const result = await fetchGuestVideo('video-id-123', 'bytes=0-99', signal);
      expect(result?.media.status).toBe(206);
      expect(mockRefreshAccessToken).not.toHaveBeenCalled();
      expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer refreshed-elsewhere');
    } finally {
      resetAuthClient();
    }
  });

  it('returns a second 401 as-is instead of retrying again', async () => {
    mockFilesGet.mockResolvedValueOnce(VIDEO).mockResolvedValueOnce(GUEST_FOLDER);
    mockGetAccessToken.mockResolvedValue({ token: 'revoked-token' });
    mockRefreshAccessToken.mockResolvedValue({ credentials: { access_token: 'fresh-token' } });
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => new Response('unauthorized', { status: 401 }));

    const result = await fetchGuestVideo('video-id-123', 'bytes=0-99', signal);

    expect(result?.media.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockRefreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it('does not refresh or retry on a non-401 error status', async () => {
    mockFilesGet.mockResolvedValueOnce(VIDEO).mockResolvedValueOnce(GUEST_FOLDER);
    mockFetch.mockReset();
    mockFetch.mockImplementation(async () => new Response('forbidden', { status: 403 }));

    const result = await fetchGuestVideo('video-id-123', 'bytes=0-99', signal);

    expect(result?.media.status).toBe(403);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it('does not refresh or retry when the request is aborted', async () => {
    mockFilesGet.mockResolvedValueOnce(VIDEO).mockResolvedValueOnce(GUEST_FOLDER);
    const controller = new AbortController();
    controller.abort();
    mockFetch.mockReset();
    mockFetch.mockRejectedValue(new DOMException('aborted', 'AbortError'));

    await expect(fetchGuestVideo('video-id-123', 'bytes=0-99', controller.signal)).rejects.toThrow('aborted');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it('does not retry a 401 if the client was aborted while the token refreshed', async () => {
    mockFilesGet.mockResolvedValueOnce(VIDEO).mockResolvedValueOnce(GUEST_FOLDER);
    const controller = new AbortController();
    mockGetAccessToken.mockResolvedValue({ token: 'revoked-token' });
    mockRefreshAccessToken.mockImplementation(async () => {
      controller.abort();
      return { credentials: { access_token: 'fresh-token' } };
    });
    mockFetch.mockReset();
    mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return new Response('unauthorized', { status: 401 });
    });

    await expect(fetchGuestVideo('video-id-123', 'bytes=0-99', controller.signal)).rejects.toThrow('aborted');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][1].signal).toBe(controller.signal);
  });

  it('caches a positive check so later range requests skip the metadata calls', async () => {
    mockFilesGet.mockResolvedValueOnce(VIDEO).mockResolvedValueOnce(GUEST_FOLDER);

    await fetchGuestVideo('video-id-123', 'bytes=0-1', signal);
    await fetchGuestVideo('video-id-123', 'bytes=2-99', signal);

    expect(mockFilesGet).toHaveBeenCalledTimes(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('re-checks a cached video once its entry is older than 5 minutes', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      mockFilesGet.mockResolvedValueOnce(VIDEO).mockResolvedValueOnce(GUEST_FOLDER);
      await fetchGuestVideo('video-id-123', 'bytes=0-1', signal);

      now.mockReturnValue(1_000_000 + 5 * 60 * 1000 - 1);
      await fetchGuestVideo('video-id-123', 'bytes=2-99', signal);
      expect(mockFilesGet).toHaveBeenCalledTimes(2);

      // Expired: the video was trashed meanwhile, so it must stop streaming.
      now.mockReturnValue(1_000_000 + 5 * 60 * 1000);
      mockFilesGet.mockResolvedValueOnce({ data: { ...VIDEO.data, trashed: true } });
      await expect(fetchGuestVideo('video-id-123', 'bytes=0-1', signal)).resolves.toBeNull();
      expect(mockFilesGet).toHaveBeenCalledTimes(3);
    } finally {
      now.mockRestore();
    }
  });

  it('evicts the oldest entry once 500 videos are cached', async () => {
    mockFilesGet.mockImplementation(async ({ fileId }: { fileId: string }) =>
      fileId === 'guest-folder' ? GUEST_FOLDER : VIDEO,
    );
    const ids = Array.from({ length: 501 }, (_, i) => `video-id-${String(i).padStart(4, '0')}`);
    try {
      for (const id of ids) await fetchGuestVideo(id, 'bytes=0-1', signal);
      expect(mockFilesGet).toHaveBeenCalledTimes(501 * 2);

      // The newest 500 are still cached...
      await fetchGuestVideo(ids[1], 'bytes=0-1', signal);
      await fetchGuestVideo(ids[500], 'bytes=0-1', signal);
      expect(mockFilesGet).toHaveBeenCalledTimes(501 * 2);

      // ...but the first one was evicted and is checked again.
      await fetchGuestVideo(ids[0], 'bytes=0-1', signal);
      expect(mockFilesGet).toHaveBeenCalledTimes(501 * 2 + 2);
    } finally {
      mockFilesGet.mockReset();
    }
  });

  it('does not cache a negative check', async () => {
    mockFilesGet.mockResolvedValueOnce({ data: { ...VIDEO.data, trashed: true } });
    await expectRejected();
    mockFilesGet.mockResolvedValueOnce(VIDEO).mockResolvedValueOnce(GUEST_FOLDER);
    await expect(fetchGuestVideo('video-id-123', 'bytes=0-1', signal)).resolves.not.toBeNull();
  });

  it('rejects a non-video file without looking up its folder', async () => {
    mockFilesGet.mockResolvedValueOnce({ data: { mimeType: 'application/pdf', parents: ['guest-folder'], trashed: false } });
    await expectRejected();
    expect(mockFilesGet).toHaveBeenCalledTimes(1);
  });

  it('rejects a video whose mime type is not a plain video/<subtype>', async () => {
    mockFilesGet.mockResolvedValueOnce({ data: { ...VIDEO.data, mimeType: 'video/mp4; text/html' } });
    await expectRejected();
  });

  it('rejects a shortcut, even one pointing at a video', async () => {
    mockFilesGet.mockResolvedValueOnce({
      data: { mimeType: 'application/vnd.google-apps.shortcut', parents: ['guest-folder'], trashed: false },
    });
    await expectRejected();
  });

  it('rejects a trashed video', async () => {
    mockFilesGet.mockResolvedValueOnce({ data: { ...VIDEO.data, trashed: true } });
    await expectRejected();
  });

  it('rejects a file with no parent or with several parents', async () => {
    mockFilesGet.mockResolvedValueOnce({ data: { ...VIDEO.data, parents: [] } });
    await expectRejected();
    mockFilesGet.mockResolvedValueOnce({ data: { ...VIDEO.data, parents: ['guest-folder', 'private-folder'] } });
    await expectRejected();
    expect(mockFilesGet).toHaveBeenCalledTimes(2);
  });

  it('rejects a video whose folder is not directly under the root', async () => {
    mockFilesGet
      .mockResolvedValueOnce(VIDEO)
      .mockResolvedValueOnce({ data: { ...GUEST_FOLDER.data, parents: ['guest-folder-parent'] } });
    await expectRejected();
  });

  it('rejects a video sitting directly in the root folder', async () => {
    mockFilesGet
      .mockResolvedValueOnce({ data: { ...VIDEO.data, parents: ['root-folder-id'] } })
      .mockResolvedValueOnce({ data: { mimeType: 'application/vnd.google-apps.folder', parents: ['my-drive'], trashed: false } });
    await expectRejected();
  });

  it('rejects a video whose parent is not a folder or is trashed', async () => {
    mockFilesGet
      .mockResolvedValueOnce(VIDEO)
      .mockResolvedValueOnce({ data: { ...GUEST_FOLDER.data, mimeType: 'application/vnd.google-apps.shortcut' } });
    await expectRejected();
    mockFilesGet.mockResolvedValueOnce(VIDEO).mockResolvedValueOnce({ data: { ...GUEST_FOLDER.data, trashed: true } });
    await expectRejected();
  });

  it('rejects everything when the root folder id is not configured', async () => {
    delete process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    await expectRejected();
    expect(mockFilesGet).not.toHaveBeenCalled();
  });

  it('returns null when Drive says the file does not exist', async () => {
    mockFilesGet.mockRejectedValueOnce(Object.assign(new Error('not found'), { response: { status: 404 } }));
    await expectRejected('missing-id-123');
  });

  it('rethrows other Drive errors', async () => {
    mockFilesGet.mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 500 } }));
    await expect(fetchGuestVideo('video-id-123', 'bytes=0-1', signal)).rejects.toThrow('boom');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
