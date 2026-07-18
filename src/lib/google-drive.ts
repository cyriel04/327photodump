import { google } from 'googleapis';
import { GalleryFile, GalleryFeedEntry } from '@/types';

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
