import { NextRequest, NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { google } from 'googleapis';
import { getAuth } from '@/lib/google-drive';

// Compare via SHA-256 digests so both buffers are the same length and the
// comparison time does not reveal the token's length or contents.
function tokensMatch(supplied: string, expected: string): boolean {
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

// In production this route is hidden (404) unless DEBUG_TOKEN is set and the
// request supplies it as ?token=. It creates/deletes Drive folders and upload
// sessions, so it must not be publicly callable.
function isAllowed(request: NextRequest): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  const expected = process.env.DEBUG_TOKEN;
  if (!expected) return false;
  const supplied = request.nextUrl.searchParams.get('token') ?? '';
  return tokensMatch(supplied, expected);
}

export async function GET(request: NextRequest) {
  if (!isAllowed(request)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const results: Record<string, string> = {};

  // 1. Check env vars exist
  results.hasClientId = !!process.env.GOOGLE_CLIENT_ID ? 'yes' : 'MISSING';
  results.hasClientSecret = !!process.env.GOOGLE_CLIENT_SECRET ? 'yes' : 'MISSING';
  results.hasRefreshToken = !!process.env.GOOGLE_REFRESH_TOKEN ? 'yes' : 'MISSING';
  const folderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID ?? '';
  results.hasFolderId = folderId ? 'yes' : 'MISSING';
  // Show only first/last 4 chars so you can confirm it's the right ID without exposing it
  results.folderIdHint = folderId
    ? `${folderId.slice(0, 4)}…${folderId.slice(-4)}`
    : 'not set';

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_REFRESH_TOKEN) {
    results.status = 'Missing OAuth2 credentials — add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN';
    return NextResponse.json(results);
  }

  // 2. Trade the refresh token for a new access token. getAccessToken() would
  // return the shared client's cached token without contacting Google, so an
  // expired/revoked refresh token (invalid_grant) would still look "ok" for up
  // to an hour. refreshAccessToken() always calls Google, and only updates the
  // shared client's credentials when the exchange succeeds.
  let accessToken: string;
  try {
    const { credentials } = await getAuth().refreshAccessToken();
    if (!credentials.access_token) {
      results.auth = 'FAILED — no token returned';
      return NextResponse.json(results);
    }
    accessToken = credentials.access_token;
    results.auth = 'ok';
  } catch (e) {
    results.auth = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
    return NextResponse.json(results);
  }

  // 3. Try reading the root folder
  try {
    const drive = google.drive({ version: 'v3', auth: getAuth() });
    const res = await drive.files.get({ fileId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID! });
    results.folderRead = `ok — found: ${res.data.name}`;
  } catch (e) {
    results.folderRead = `FAILED: ${e instanceof Error ? e.message : String(e)}`;
  }

  // 4. Test write access — create a temp subfolder then delete it
  try {
    const drive = google.drive({ version: 'v3', auth: getAuth() });
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

  // 5. Test resumable upload session creation, with the token just obtained
  // from Google in step 2 rather than a possibly stale cached one.
  try {
    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
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
