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

function guestFolderQuery(guestName: string, rootFolderId: string): string {
  return `name='${escapeDriveQueryValue(guestName)}' and '${escapeDriveQueryValue(rootFolderId)}' in parents and mimeType='${FOLDER_MIME_TYPE}' and trashed=false`;
}

function parentsQuery(folderIds: string[]): string {
  return folderIds.map((id) => `'${escapeDriveQueryValue(id)}' in parents`).join(' or ');
}

/**
 * Find a guest's folder under the root without creating it. Returns null if absent.
 * Two simultaneous first uploads can create two same-name folders; ordering by
 * createdTime (oldest first) makes the same one win every time for new uploads.
 */
export async function findGuestFolder(guestName: string): Promise<string | null> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;

  const response = await drive.files.list({
    q: guestFolderQuery(guestName, rootFolderId),
    fields: 'files(id)',
    orderBy: 'createdTime',
    pageSize: 1,
  });

  return response.data.files?.[0]?.id ?? null;
}

// Normally 1 folder per name; more only after a first-upload race.
const GUEST_FOLDERS_PAGE_SIZE = 100;

/** Every folder under the root with this exact guest name (usually one). */
async function findAllGuestFolders(guestName: string): Promise<string[]> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!;

  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const response = await drive.files.list({
      q: guestFolderQuery(guestName, rootFolderId),
      fields: 'nextPageToken, files(id)',
      orderBy: 'createdTime',
      pageSize: GUEST_FOLDERS_PAGE_SIZE,
      pageToken,
    });
    for (const f of response.data.files ?? []) {
      if (f.id) ids.push(f.id);
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  return ids;
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
  const folderId = folder.data.id!;

  try {
    await setFolderPubliclyViewable(folderId);
  } catch (error) {
    // A private folder would be found by later uploads and never made public,
    // so thumbnails would never load. Remove it so the next upload retries cleanly.
    try {
      await drive.files.delete({ fileId: folderId });
    } catch (cleanupError) {
      const message = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      console.error(`Failed to remove private guest folder for "${guestName}":`, message);
    }
    throw error;
  }

  return folderId;
}

export async function setFolderPubliclyViewable(folderId: string): Promise<void> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  await drive.permissions.create({
    fileId: folderId,
    requestBody: { role: 'reader', type: 'anyone' },
  });
}

// Per-page size for a guest's files. Usually one page (MAX_SHOTS is 30), but a
// shared name, two phones or cleared storage can exceed it, so we paginate.
const GUEST_FILES_PAGE_SIZE = 100;
// Max folder ids OR-ed into one `in parents` query, to keep `q` a sane length.
const FOLDER_CHUNK_SIZE = 100;
const LIST_PAGE_SIZE = 1000;

/**
 * List a guest's files across every same-name folder under the root, newest
 * first. Read-only: returns [] if the guest has no folder yet.
 */
export async function listGuestFiles(guestName: string): Promise<GalleryFile[]> {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const folderIds = await findAllGuestFolders(guestName);
  if (folderIds.length === 0) return [];

  const files: GalleryFile[] = [];
  for (let i = 0; i < folderIds.length; i += FOLDER_CHUNK_SIZE) {
    const chunk = folderIds.slice(i, i + FOLDER_CHUNK_SIZE);
    let pageToken: string | undefined;
    do {
      const response = await drive.files.list({
        q: `(${parentsQuery(chunk)}) and trashed=false`,
        fields: 'nextPageToken, files(id, mimeType, thumbnailLink, webContentLink, createdTime)',
        orderBy: 'createdTime desc',
        pageSize: GUEST_FILES_PAGE_SIZE,
        pageToken,
      });
      for (const file of response.data.files ?? []) {
        files.push({
          id: file.id!,
          mimeType: file.mimeType!,
          thumbnailLink: file.thumbnailLink ?? null,
          viewUrl: file.webContentLink!,
          createdTime: file.createdTime!,
        });
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
  }

  // Drive orders within a query; re-sort so multiple chunks/pages merge correctly.
  return files.sort((a, b) => (a.createdTime < b.createdTime ? 1 : a.createdTime > b.createdTime ? -1 : 0));
}

/**
 * One feed entry per guest name, most recent activity first. Same-name folders
 * (from a first-upload race) are merged: the newest file across them wins.
 * Folders with no files are omitted.
 */
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
  const mostRecentByName = new Map<string, GalleryFeedEntry>();

  // Every page is read: an empty folder (created before its first upload lands)
  // means we can never know a chunk is "complete" early, so there is no
  // short-circuit here. Cost is ~ceil(files / 1000) calls per 100 folders.
  for (let i = 0; i < folders.length; i += FOLDER_CHUNK_SIZE) {
    const chunk = folders.slice(i, i + FOLDER_CHUNK_SIZE);
    let filePageToken: string | undefined;
    do {
      const filesResponse = await drive.files.list({
        q: `(${parentsQuery(chunk.map((f) => f.id))}) and trashed=false`,
        fields: 'nextPageToken, files(parents, thumbnailLink, createdTime)',
        orderBy: 'createdTime desc',
        pageSize: LIST_PAGE_SIZE,
        pageToken: filePageToken,
      });

      for (const file of filesResponse.data.files ?? []) {
        const folderId = file.parents?.[0];
        const guestName = folderId ? folderNameById.get(folderId) : undefined;
        if (!guestName || !file.createdTime) continue;
        const current = mostRecentByName.get(guestName);
        if (!current || file.createdTime > current.mostRecentTime) {
          mostRecentByName.set(guestName, {
            guestName,
            coverThumbnail: file.thumbnailLink ?? null,
            mostRecentTime: file.createdTime,
          });
        }
      }

      filePageToken = filesResponse.data.nextPageToken ?? undefined;
    } while (filePageToken);
  }

  return Array.from(mostRecentByName.values()).sort((a, b) =>
    a.mostRecentTime < b.mostRecentTime ? 1 : a.mostRecentTime > b.mostRecentTime ? -1 : 0,
  );
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
