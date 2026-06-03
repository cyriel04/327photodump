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

  // 1. Check env vars exist
  results.hasClientId = !!process.env.GOOGLE_CLIENT_ID ? 'yes' : 'MISSING';
  results.hasClientSecret = !!process.env.GOOGLE_CLIENT_SECRET ? 'yes' : 'MISSING';
  results.hasRefreshToken = !!process.env.GOOGLE_REFRESH_TOKEN ? 'yes' : 'MISSING';
  results.hasFolderId = !!process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ? 'yes' : 'MISSING';
  results.folderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? 'not set';

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    results.status = 'Missing OAuth2 credentials — add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN';
    return NextResponse.json(results);
  }

  // 2. Try getting an access token
  try {
    const auth = makeAuth();
    const { token } = await auth.getAccessToken();
    results.auth = token ? 'ok' : 'FAILED — no token returned';
  } catch (e) {
    results.auth = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
    return NextResponse.json(results);
  }

  // 3. Try reading the root folder
  try {
    const drive = google.drive({ version: 'v3', auth: makeAuth() });
    const res = await drive.files.get({ fileId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID! });
    results.folderRead = `ok — found: ${res.data.name}`;
  } catch (e) {
    results.folderRead = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 4. Test write access — create a temp subfolder then delete it
  try {
    const drive = google.drive({ version: 'v3', auth: makeAuth() });
    const created = await drive.files.create({
      requestBody: {
        name: '__debug_write_test__',
        mimeType: 'application/vnd.google-apps.folder',
        parents: [process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!],
      },
      fields: 'id',
    });
    const testId = created.data.id!;
    await drive.files.delete({ fileId: testId });
    results.writeAccess = 'ok — created and deleted a test folder';
  } catch (e) {
    results.writeAccess = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 5. Test resumable upload session creation
  try {
    const auth = makeAuth();
    const { token } = await auth.getAccessToken();
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'image/jpeg',
          'X-Upload-Content-Length': '1000',
        },
        body: JSON.stringify({
          name: '__debug_upload_session_test__.jpg',
          parents: [process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID!],
        }),
      },
    );
    if (res.ok) {
      results.resumableSession = 'ok — got upload URL';
    } else {
      const body = await res.text();
      results.resumableSession = `FAILED (${res.status}): ${body}`;
    }
  } catch (e) {
    results.resumableSession = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json(results);
}
