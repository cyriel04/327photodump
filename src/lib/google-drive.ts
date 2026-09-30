import { google } from 'googleapis';
import { GalleryFile, GalleryFeedEntry } from '@/types';

const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder';

export function getAuth() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    'urn:ietf:wg:oauth:2.0:oob',
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN! });
  return oauth2Client;
}

/**
 * Escape a value for use inside a single-quoted Drive `q` string literal.
 * Per the Drive query syntax, `\` and `'` must be backslash-escaped. Backslashes
 * are escaped first so an input ending in `\` cannot neutralise the quote escape.
 */
export function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Find a guest's folder under the root without creating it. Returns null if absent. */
export async function findGuestFolder(guestName: string): Promise<string | null> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;

  const response = await drive.files.list({
    q: `name='${escapeDriveQueryValue(guestName)}' and '${escapeDriveQueryValue(rootFolderId)}' in parents and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`,
    fields: 'files(id)',
    pageSize: 1,
  });

  return response.data.files?.[0]?.id ?? null;
}

export async function findOrCreateGuestFolder(guestName: string): Promise<string> {
  const existing = await findGuestFolder(guestName);
  if (existing) return existing;

  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;

  const folder = await drive.files.create({
    requestBody: {
      name: guestName,
      mimeType: FOLDER_MIME_TYPE,
      parents: [rootFolderId],
    },
    fields: 'id',
  });

  await setFolderPubliclyViewable(folder.data.id!);

  return folder.data.id!;
}

export async function setFolderPubliclyViewable(folderId: string): Promise<void> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  await drive.permissions.create({
    fileId: folderId,
    requestBody: { role: 'reader', type: 'anyone' },
  });
}

// A guest has at most MAX_SHOTS (30) files, so one page of 100 covers it.
const GUEST_FILES_PAGE_SIZE = 100;

/** List a guest's files. Read-only: returns [] if the guest has no folder yet. */
export async function listGuestFiles(guestName: string): Promise<GalleryFile[]> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const folderId = await findGuestFolder(guestName);
  if (!folderId) return [];

  const response = await drive.files.list({
    q: `'${escapeDriveQueryValue(folderId)}' in parents and trashed=false`,
    fields: 'files(id, mimeType, thumbnailLink, webContentLink, createdTime)',
    orderBy: 'createdTime desc',
    pageSize: GUEST_FILES_PAGE_SIZE,
  });

  return (response.data.files ?? []).map((file) => ({
    id: file.id!,
    mimeType: file.mimeType!,
    thumbnailLink: file.thumbnailLink ?? null,
    viewUrl: file.webContentLink!,
    createdTime: file.createdTime!,
  }));
}

const FOLDER_CHUNK_SIZE = 100;
const LIST_PAGE_SIZE = 1000;

export async function listGuestsByActivity(): Promise<GalleryFeedEntry[]> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;

  const folders: { id: string; name: string }[] = [];
  let folderPageToken: string | undefined;
  do {
    const foldersResponse = await drive.files.list({
      q: `'${escapeDriveQueryValue(rootFolderId)}' in parents and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`,
      fields: 'nextPageToken, files(id, name)',
      pageSize: LIST_PAGE_SIZE,
      pageToken: folderPageToken,
    });
    for (const f of foldersResponse.data.files ?? []) {
      folders.push({ id: f.id!, name: f.name! });
    }
    folderPageToken = foldersResponse.data.nextPageToken ?? undefined;
  } while (folderPageToken);

  if (folders.length === 0) return [];

  const folderNameById = new Map(folders.map((f) => [f.id, f.name]));
  const mostRecentByFolder = new Map<string, { thumbnailLink: string | null; createdTime: string }>();

  for (let i = 0; i < folders.length; i += FOLDER_CHUNK_SIZE) {
    const chunk = folders.slice(i, i + FOLDER_CHUNK_SIZE);
    const q = chunk.map((f) => `'${escapeDriveQueryValue(f.id)}' in parents`).join(' or ');
    let filePageToken: string | undefined;
    do {
      const filesResponse = await drive.files.list({
        q: `(${q}) and trashed=false`,
        fields: 'nextPageToken, files(parents, thumbnailLink, createdTime)',
        orderBy: 'createdTime desc',
        pageSize: LIST_PAGE_SIZE,
        pageToken: filePageToken,
      });

      for (const file of filesResponse.data.files ?? []) {
        const folderId = file.parents?.[0];
        if (!folderId || mostRecentByFolder.has(folderId)) continue;
        mostRecentByFolder.set(folderId, {
          thumbnailLink: file.thumbnailLink ?? null,
          createdTime: file.createdTime!,
        });
      }

      // Results are newest-first, so once every folder in the chunk has its
      // latest file there is nothing more to learn from further pages.
      const chunkComplete = chunk.every((f) => mostRecentByFolder.has(f.id));
      filePageToken = chunkComplete ? undefined : (filesResponse.data.nextPageToken ?? undefined);
    } while (filePageToken);
  }

  return Array.from(mostRecentByFolder.entries())
    .map(([folderId, info]) => ({
      guestName: folderNameById.get(folderId)!,
      coverThumbnail: info.thumbnailLink,
      mostRecentTime: info.createdTime,
    }))
    .sort((a, b) => (a.mostRecentTime < b.mostRecentTime ? 1 : -1));
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
