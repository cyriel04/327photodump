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
} from '@/lib/google-drive';

// Mock functions are created inside the factory to avoid hoisting issues.
// We expose them on __mockFns so tests can access them via jest.requireMock.
jest.mock('googleapis', () => {
  const filesList = jest.fn();
  const filesCreate = jest.fn();
  const filesDelete = jest.fn();
  const permissionsCreate = jest.fn();
  const getAccessToken = jest.fn();
  const setCredentials = jest.fn();
  return {
    google: {
      auth: {
        OAuth2: jest.fn().mockImplementation(() => ({ getAccessToken, setCredentials })),
      },
      drive: jest.fn().mockReturnValue({
        files: { list: filesList, create: filesCreate, delete: filesDelete },
        permissions: { create: permissionsCreate },
      }),
    },
    __mockFns: { filesList, filesCreate, filesDelete, permissionsCreate, getAccessToken, setCredentials },
  };
});

const { __mockFns } = jest.requireMock('googleapis');
const mockFilesList: jest.Mock = __mockFns.filesList;
const mockFilesCreate: jest.Mock = __mockFns.filesCreate;
const mockFilesDelete: jest.Mock = __mockFns.filesDelete;
const mockPermissionsCreate: jest.Mock = __mockFns.permissionsCreate;
const mockGetAccessToken: jest.Mock = __mockFns.getAccessToken;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.GOOGLE_CLIENT_ID = 'test-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
  process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID = 'root-folder-id';
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
  it('deletes the just-created folder and rethrows when permissions.create fails', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });
    mockFilesCreate.mockResolvedValue({ data: { id: 'new-folder-id' } });
    mockPermissionsCreate.mockRejectedValueOnce(new Error('permission denied'));
    mockFilesDelete.mockResolvedValue({});

    await expect(findOrCreateGuestFolder('Cyriel')).rejects.toThrow('permission denied');
    expect(mockFilesDelete).toHaveBeenCalledWith({ fileId: 'new-folder-id' });
  });

  it('still rethrows the permission error and logs when the cleanup delete also fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFilesList.mockResolvedValue({ data: { files: [] } });
    mockFilesCreate.mockResolvedValue({ data: { id: 'new-folder-id' } });
    mockPermissionsCreate.mockRejectedValueOnce(new Error('permission denied'));
    mockFilesDelete.mockRejectedValueOnce(new Error('delete failed'));

    await expect(findOrCreateGuestFolder("O'Brien")).rejects.toThrow('permission denied');
    expect(mockFilesDelete).toHaveBeenCalledWith({ fileId: 'new-folder-id' });
    expect(errorSpy).toHaveBeenCalled();
    const logged = errorSpy.mock.calls.flat().map(String).join(' ');
    expect(logged).toContain('delete failed');
    expect(logged).not.toContain('test-refresh-token');
    expect(logged).not.toContain('test-client-secret');
    expect(logged).not.toContain('root-folder-id');
    errorSpy.mockRestore();
  });

  it('does not delete anything when the permission succeeds', async () => {
    mockFilesList.mockResolvedValue({ data: { files: [] } });
    mockFilesCreate.mockResolvedValue({ data: { id: 'new-folder-id' } });
    mockPermissionsCreate.mockResolvedValue({});

    await findOrCreateGuestFolder('Cyriel');

    expect(mockFilesDelete).not.toHaveBeenCalled();
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
