'use client';

import { useState, useRef } from 'react';

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
    <div className="camera-capture">
      <p className="shot-counter">
        Hi {guestName}! 🎞 {shotsRemaining} shots left
      </p>

      {!pendingFile && (
        <div className="capture-buttons">
          <button onClick={() => photoInputRef.current?.click()}>Take Photo</button>
          <button onClick={() => videoInputRef.current?.click()}>Record Video</button>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <input
            ref={videoInputRef}
            type="file"
            accept="video/*"
            capture="environment"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
        </div>
      )}

      {previewUrl && pendingFile && (
        <div className="preview">
          {pendingFile.type.startsWith('image/') ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Preview" />
          ) : (
            <video src={previewUrl} controls playsInline />
          )}
          <div className="preview-actions">
            <button onClick={handleUpload} disabled={uploadStatus === 'uploading'}>
              {uploadStatus === 'uploading' ? `Uploading… ${progress}%` : 'Upload'}
            </button>
            <button onClick={handleRetake}>Retake</button>
          </div>
        </div>
      )}

      {uploadStatus === 'uploading' && <progress value={progress} max={100} />}

      {error && <p className="error">{error}</p>}
    </div>
  );
}
