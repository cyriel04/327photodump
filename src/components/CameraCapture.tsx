'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

interface Props {
  guestName: string;
  shotsRemaining: number;
  shotCount: number;
  onUploadSuccess: () => void;
  onEndSession: () => void;
}

type UploadStatus = 'idle' | 'uploading' | 'error';

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
    if (!file) return;

    if (file.type.startsWith('video/') && file.size > MAX_VIDEO_SIZE) {
      setError('Video too large — try a shorter clip');
      return;
    }

    setError(null);
    setPendingFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const getFileName = (file: File): string => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const ext = file.name.split('.').pop() ?? (file.type.startsWith('image/') ? 'jpg' : 'mp4');
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
        .then((res) => {
          if (!res.ok)
            return res.json().then((b) => Promise.reject(new Error(b.error ?? 'Failed to get upload URL')));
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
            if (xhr.status < 300) resolve();
            else {
              const detail = xhr.responseText ? `: ${xhr.responseText.slice(0, 200)}` : '';
              reject(new Error(`Upload failed (${xhr.status})${detail}`));
            }
          };
          xhr.onerror = () => reject(new Error('Upload failed — network error'));
          xhr.send(file);
        })
        .catch((err: Error) => reject(err));
    });

  const handleUpload = async () => {
    if (!pendingFile) return;
    setUploadStatus('uploading');
    setProgress(0);
    setError(null);

    try {
      await upload(pendingFile);
      setPreviewUrl(null);
      setPendingFile(null);
      setUploadStatus('idle');
      onUploadSuccess();
    } catch (err) {
      setUploadStatus('error');
      setError(err instanceof Error ? err.message : 'Upload failed — tap to retry');
    }
  };

  // window.confirm() is unreliable on mobile (silently no-ops in Brave, in-app
  // webviews, and iOS Safari right after a native camera handoff), so the
  // confirmation is rendered in-page instead of using a native dialog.
  const handleCancelEndSession = () => {
    setConfirmingEnd(false);
  };

  const handleRetake = () => {
    setPendingFile(null);
    setPreviewUrl(null);
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
                className="text-xs text-muted-foreground underline self-center"
              >
                I&apos;m done — end film early
              </button>
            )}
            {confirmingEnd && (
              <div className="flex flex-col items-center gap-2 text-center">
                <p className="text-xs text-muted-foreground">
                  End your film now with {shotCount} shot{shotCount === 1 ? '' : 's'}?
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={onEndSession}
                    className="text-xs font-semibold text-amber-400 underline"
                  >
                    Yes, end it
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelEndSession}
                    className="text-xs text-muted-foreground underline"
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
              <Button
                onClick={handleUpload}
                disabled={uploadStatus === 'uploading'}
                className="flex-1 bg-amber-400 text-black hover:bg-amber-300 font-semibold"
              >
                {uploadStatus === 'uploading' ? `Uploading… ${progress}%` : 'Upload'}
              </Button>
              <Button onClick={handleRetake} variant="outline">
                Retake
              </Button>
            </div>
          </div>
        )}

        {uploadStatus === 'uploading' && (
          <Progress value={progress} className="h-2" />
        )}

        {error && (
          <p className="text-destructive text-sm">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}
