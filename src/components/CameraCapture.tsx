'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

const MAX_VIDEO_SIZE = 100 * 1024 * 1024;

interface Props {
  guestName: string;
  shotsRemaining: number;
  onUploadSuccess: () => void;
}

type UploadStatus = 'idle' | 'uploading' | 'error';

export function CameraCapture({ guestName, shotsRemaining, onUploadSuccess }: Props) {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

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
            else reject(new Error(`Upload failed (${xhr.status})`));
          };
          xhr.onerror = () => reject(new Error('Upload failed — tap to retry'));
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

  const handleRetake = () => {
    setPendingFile(null);
    setPreviewUrl(null);
    setError(null);
    setUploadStatus('idle');
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="pb-2">
        <p className="text-lg font-semibold text-amber-400">
          Hi {guestName}! 🎞 {shotsRemaining} shots left
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {!pendingFile && (
          <div className="flex flex-col gap-3">
            <Button
              onClick={() => photoInputRef.current?.click()}
              className="w-full bg-amber-400 text-black hover:bg-amber-300 font-semibold h-14 text-base"
            >
              📷 Take Photo
            </Button>
            <Button
              onClick={() => videoInputRef.current?.click()}
              variant="outline"
              className="w-full h-14 text-base font-semibold"
            >
              🎥 Record Video
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
          </div>
        )}

        {previewUrl && pendingFile && (
          <div className="space-y-3">
            {pendingFile.type.startsWith('image/') ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="Preview" className="w-full rounded-lg max-h-[60vh] object-cover" />
            ) : (
              <video src={previewUrl} controls playsInline className="w-full rounded-lg max-h-[60vh]" />
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
