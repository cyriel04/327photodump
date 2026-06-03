import { google } from 'googleapis';

function getAuth() {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!);
  // Vercel sometimes escapes \n in env vars — restore actual newlines in the private key
  const privateKey = key.private_key.replace(/\\n/g, '\n');
  return new google.auth.JWT({
    email: key.client_email,
    key: privateKey,
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

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Drive resumable session failed (${response.status}): ${body}`);
  }

  const uploadUrl = response.headers.get('Location');
  if (!uploadUrl) throw new Error('Failed to get upload URL from Google Drive');
  return uploadUrl;
}
