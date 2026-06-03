import { NextResponse } from 'next/server';
import { google } from 'googleapis';

function makeAuth() {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!);
  const privateKey = key.private_key.replace(/\\n/g, '\n');
  return new google.auth.JWT({
    email: key.client_email,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

export async function GET() {
  const results: Record<string, string> = {};

  // 1. Check env vars exist
  results.hasServiceAccountKey = !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY ? 'yes' : 'MISSING';
  results.hasFolderId = !!process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ? 'yes' : 'MISSING';
  results.folderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? 'not set';

  // 2. Try parsing the key
  try {
    const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY!);
    results.keyParsed = 'ok';
    results.clientEmail = key.client_email ?? 'missing field';
    results.hasPrivateKey = key.private_key ? 'yes' : 'MISSING';
  } catch (e) {
    results.keyParsed = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
    return NextResponse.json(results);
  }

  // 3. Try authenticating
  try {
    const auth = makeAuth();
    const { token } = await auth.getAccessToken();
    results.auth = token ? 'ok' : 'FAILED — no token returned';
  } catch (e) {
    results.auth = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
    return NextResponse.json(results);
  }

  // 4. Try reading the root folder
  try {
    const drive = google.drive({ version: 'v3', auth: makeAuth() });
    const res = await drive.files.get({ fileId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID! });
    results.folderRead = `ok — found: ${res.data.name}`;
  } catch (e) {
    results.folderRead = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 5. Test write access — create a temp subfolder then delete it
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

  // 6. Test resumable upload session creation
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
      }
    );
    if (res.ok) {
      results.resumableSession = `ok — got upload URL`;
    } else {
      const body = await res.text();
      results.resumableSession = `FAILED (${res.status}): ${body}`;
    }
  } catch (e) {
    results.resumableSession = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  return NextResponse.json(results);
}
