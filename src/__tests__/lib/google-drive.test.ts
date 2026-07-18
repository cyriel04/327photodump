/**
 * @jest-environment node
 */
import {
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
