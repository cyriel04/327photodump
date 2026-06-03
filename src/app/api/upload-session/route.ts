import { NextRequest, NextResponse } from 'next/server';
import { findOrCreateGuestFolder, createResumableUploadSession } from '@/lib/google-drive';
import { UploadSessionRequest, UploadSessionResponse } from '@/types';

const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const body: UploadSessionRequest = await request.json();
    const { guestName, fileName, mimeType, fileSize } = body;

    if (!guestName || !fileName || !mimeType || !fileSize) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    if (mimeType.startsWith('video/') && fileSize > MAX_VIDEO_SIZE) {
      return NextResponse.json({ error: 'Video too large' }, { status: 400 });
    }

    const folderId = await findOrCreateGuestFolder(guestName);
    const uploadUrl = await createResumableUploadSession(folderId, fileName, mimeType, fileSize);

    const response: UploadSessionResponse = { uploadUrl, folderId };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Upload session error:', error);
    return NextResponse.json({ error: 'Failed to create upload session' }, { status: 500 });
  }
}
