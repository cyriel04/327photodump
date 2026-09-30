'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { MAX_IMAGE_SIZE, MAX_VIDEO_SIZE } from '@/lib/upload-limits';

const IMAGE_TOO_LARGE_MESSAGE = 'Photo too large — try again';
const VIDEO_TOO_LARGE_MESSAGE = 'Video too large — try a shorter clip';
// Raw Drive/API responses are never surfaced to guests — they're meaningless to
// them and can leak internal details.
// Transient failures (5xx, network, Drive PUT): the same file can be retried.
const UPLOAD_FAILED_MESSAGE = 'Upload failed — check your connection and tap Upload to retry';
// Our API rejected the file itself (4xx): retrying the same file won't help.
const UPLOAD_REJECTED_MESSAGE = "This file can't be uploaded — try retaking it";

// Maps known `error` strings from POST /api/upload-session 400s to guest-facing text.
const REJECTION_MESSAGES: Record<string, string> = {
  'Image too large': IMAGE_TOO_LARGE_MESSAGE,
  'Video too large': VIDEO_TOO_LARGE_MESSAGE,
};

/** The API refused this file (4xx) — carries the guest-facing message. */
class UploadRejectedError extends Error {}

async function rejectionMessage(res: Response): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return REJECTION_MESSAGES[body.error] ?? UPLOAD_REJECTED_MESSAGE;
    }
  } catch {
    // Non-JSON body (e.g. a proxy's 413 page) — fall through to the generic message.
  }
  return UPLOAD_REJECTED_MESSAGE;
}

// Only trust an extension that looks like one (e.g. "jpg", "HEIC", "mov"). Names
// without a dot, or with junk after the last dot, fall back to a sensible default.
const FILE_EXTENSION = /^[a-z0-9]{1,5}$/i;

function fileExtension(file: File): string {
  const dot = file.name.lastIndexOf('.');
  const candidate = dot >= 0 ? file.name.slice(dot + 1) : '';
  if (FILE_EXTENSION.test(candidate)) return candidate;
  return file.type.startsWith('image/') ? 'jpg' : 'mp4';
}

interface Props {
  guestName: string;
  shotsRemaining: number;
  shotCount: number;
  onUploadSuccess: () => void;
  onEndSession: () => void;
}

// 'error' = retryable failure; 'rejected' = the API refused the file, retake needed.
type UploadStatus = 'idle' | 'uploading' | 'error' | 'rejected';

export function CameraCapture({ guestName, shotsRemaining, shotCount, onUploadSuccess, onEndSession }: Props) {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [showVideoControls, setShowVideoControls] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const hideControlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // State updates don't land until the next render, so a fast double-tap could
  // start two uploads. A ref flips synchronously and blocks the second tap.
  const uploadingRef = useRef(false);
  const previewUrlRef = useRef<string | null>(null);

  const replacePreviewUrl = (next: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = next;
    setPreviewUrl(next);
  };

  useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
    },
    []
  );

  const revealVideoControls = () => {
    setShowVideoControls(true);
    if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
    hideControlsTimeoutRef.current = setTimeout(() => setShowVideoControls(false), 3000);
  };

  const hideVideoControls = () => {
    if (hideControlsTimeoutRef.current) clearTimeout(hideControlsTimeoutRef.current);
    setShowVideoControls(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again (e.g. after a rejection) still fires onChange.
    e.target.value = '';
    if (!file) return;

    if (file.type.startsWith('video/') && file.size > MAX_VIDEO_SIZE) {
      setError(VIDEO_TOO_LARGE_MESSAGE);
      return;
    }
    if (file.type.startsWith('image/') && file.size > MAX_IMAGE_SIZE) {
      setError(IMAGE_TOO_LARGE_MESSAGE);
      return;
    }

    setError(null);
    setPendingFile(file);
    replacePreviewUrl(URL.createObjectURL(file));
  };

  const getFileName = (file: File): string => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = fileExtension(file);
    const prefix = file.type.startsWith('image/') ? 'photo' : 'video';
    return `${prefix}-${ts}.${ext}`;
  };

  const upload = (file: File): Promise<void> =>
    new Promise((resolve, reject) => {
      const fileName = getFileName(file);

      fetch('/api/upload-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guestName, fileName, mimeType: file.type, fileSize: file.size }),
      })
        .then(async (res) => {
          if (res.status >= 400 && res.status < 500) {
            throw new UploadRejectedError(await rejectionMessage(res));
          }
          if (!res.ok) throw new Error(`Upload session request failed (${res.status})`);
          return res.json();
        })
        .then(({ uploadUrl }: { uploadUrl: string }) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', uploadUrl);
          xhr.setRequestHeader('Content-Type', file.type);
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload failed (${xhr.status})`));
          };
          xhr.onerror = () => reject(new Error('Upload failed — network error'));
          xhr.send(file);
        })
        .catch((err: Error) => reject(err));
    });

  const handleUpload = async () => {
    if (!pendingFile || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploadStatus('uploading');
    setProgress(0);
    setError(null);

    try {
      await upload(pendingFile);
      replacePreviewUrl(null);
      setPendingFile(null);
      setUploadStatus('idle');
      onUploadSuccess();
    } catch (err) {
      console.error('Upload failed:', err);
      if (err instanceof UploadRejectedError) {
        // Retrying the same file would be refused again — only Retake is offered.
        setUploadStatus('rejected');
        setError(err.message);
      } else {
        // Keep pendingFile + preview so the guest can retry without re-taking the shot.
        setUploadStatus('error');
        setError(UPLOAD_FAILED_MESSAGE);
      }
    } finally {
      uploadingRef.current = false;
    }
  };

  // window.confirm() is unreliable on mobile (silently no-ops in Brave, in-app
  // webviews, and iOS Safari right after a native camera handoff), so the
  // confirmation is rendered in-page instead of using a native dialog.
  const handleCancelEndSession = () => {
    setConfirmingEnd(false);
  };

  const handleRetake = () => {
    if (uploadingRef.current) return;
    setPendingFile(null);
    replacePreviewUrl(null);
    setError(null);
    setUploadStatus('idle');
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="pb-1 pt-4">
        <p className="text-base font-semibold text-amber-400">
          Hi {guestName}! 🎞 {shotsRemaining} shots left
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {!pendingFile && (
          <div className="flex flex-col gap-3">
            <Button
              onClick={() => photoInputRef.current?.click()}
              className="w-full bg-amber-400 text-black hover:bg-amber-300 font-semibold h-12 text-base"
            >
              📷 Take Photo
            </Button>
            <Button
              onClick={() => videoInputRef.current?.click()}
              variant="outline"
              className="w-full h-auto py-2 flex flex-col font-semibold"
            >
              <span className="text-base">🎥 Record Video</span>
              <span className="text-xs font-normal opacity-60">Keep it under 60 seconds</span>
            </Button>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
            {shotCount > 0 && !confirmingEnd && (
              <button
                type="button"
                onClick={() => setConfirmingEnd(true)}
                className="min-h-11 px-3 text-xs text-muted-foreground underline self-center"
              >
                I&apos;m done — end film early
              </button>
            )}
            {confirmingEnd && (
              <div className="flex flex-col items-center gap-2 text-center">
                <p className="text-xs text-muted-foreground">
                  End your film now with {shotCount} shot{shotCount === 1 ? '' : 's'}?
                </p>
                <div className="flex">
                  <button
                    type="button"
                    onClick={onEndSession}
                    className="min-h-11 px-1.5 text-xs font-semibold text-amber-400 underline"
                  >
                    Yes, end it
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEndSession}
                    className="min-h-11 px-1.5 text-xs text-muted-foreground underline"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {previewUrl && pendingFile && (
          <div className="space-y-3">
            {pendingFile.type.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Preview" className="w-full rounded-lg max-h-[60vh] object-cover" />
            ) : (
              <video
                src={previewUrl}
                controls={showVideoControls}
                playsInline
                className="w-full rounded-lg max-h-[60vh]"
                onMouseEnter={revealVideoControls}
                onMouseMove={revealVideoControls}
                onMouseLeave={hideVideoControls}
                onTouchStart={revealVideoControls}
              />
            )}
            <div className="flex gap-3">
              {/* No `disabled` here — iOS drops taps near disabled buttons. The
                  handler's ref guard ignores taps while an upload is running. */}
              {uploadStatus !== 'rejected' && (
                <Button
                  type="button"
                  onClick={handleUpload}
                  aria-busy={uploadStatus === 'uploading'}
                  className={cn(
                    'flex-1 bg-amber-400 text-black hover:bg-amber-300 font-semibold',
                    uploadStatus === 'uploading' && 'opacity-50 cursor-not-allowed'
                  )}
                >
                  {uploadStatus === 'uploading' ? `Uploading… ${progress}%` : 'Upload'}
                </Button>
              )}
              {uploadStatus !== 'uploading' && (
                <Button
                  type="button"
                  onClick={handleRetake}
                  variant="outline"
                  className={cn(uploadStatus === 'rejected' && 'flex-1')}
                >
                  Retake
                </Button>
              )}
            </div>
          </div>
        )}

        {uploadStatus === 'uploading' && (
          <Progress value={progress} className="h-2" />
        )}

        {error && (
          <p role="alert" className="text-destructive text-sm">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
