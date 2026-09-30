import { NextRequest, NextResponse } from 'next/server';
import { findOrCreateGuestFolder, createResumableUploadSession } from '@/lib/google-drive';
import { UploadSessionResponse } from '@/types';
import {
  MAX_FILE_NAME_LENGTH,
  MAX_IMAGE_SIZE,
  MAX_VIDEO_SIZE,
  parseGuestName,
} from '../_lib/validation';

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest('Invalid JSON body');
  }

  if (!body || typeof body !== 'object') {
    return badRequest('Missing required fields');
  }

  const { guestName: rawGuestName, fileName, mimeType, fileSize } = body as Record<string, unknown>;

  if (!rawGuestName || !fileName || !mimeType || !fileSize) {
    return badRequest('Missing required fields');
  }

  const guestName = parseGuestName(rawGuestName);
  if (!guestName) {
    return badRequest('Invalid guestName');
  }

  if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > MAX_FILE_NAME_LENGTH) {
    return badRequest('Invalid fileName');
  }

  if (typeof mimeType !== 'string') {
    return badRequest('Unsupported file type');
  }
  const isVideo = mimeType.startsWith('video/');
  const isImage = mimeType.startsWith('image/');
  if (!isVideo && !isImage) {
    return badRequest('Unsupported file type');
  }

  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize <= 0) {
    return badRequest('Invalid fileSize');
  }

  if (isVideo && fileSize > MAX_VIDEO_SIZE) {
    return badRequest('Video too large');
  }
  if (isImage && fileSize > MAX_IMAGE_SIZE) {
    return badRequest('Image too large');
  }

  try {
    const origin = request.headers.get('origin') ?? undefined;
    const folderId = await findOrCreateGuestFolder(guestName);
    const uploadUrl = await createResumableUploadSession(folderId, fileName, mimeType, fileSize, origin);

    const response: UploadSessionResponse = { uploadUrl, folderId };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Upload session error:', message);
    return NextResponse.json({ error: 'Failed to create upload session' }, { status: 500 });
  }
}
