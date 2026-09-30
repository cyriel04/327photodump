import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CameraCapture } from '@/components/CameraCapture';

// jsdom doesn't implement URL.createObjectURL
let objectUrlCounter = 0;
global.URL.createObjectURL = jest.fn(() => `blob:mock-url-${++objectUrlCounter}`);
global.URL.revokeObjectURL = jest.fn();

type MockXhr = {
  open: jest.Mock;
  setRequestHeader: jest.Mock;
  send: jest.Mock;
  upload: { onprogress: ((e: ProgressEvent) => void) | null };
  onload: ((e: ProgressEvent) => void) | null;
  onerror: ((e: ProgressEvent) => void) | null;
  status: number;
  responseText: string;
};

function mockUploadSession() {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ uploadUrl: 'https://upload.googleapis.com/mock', folderId: 'f1' }),
  }) as jest.Mock;
}

function mockXhr(outcome: 'success' | 'http-error' | 'network-error' | 'pending'): MockXhr {
  const xhr: MockXhr = {
    open: jest.fn(),
    setRequestHeader: jest.fn(),
    send: jest.fn(),
    upload: { onprogress: null },
    onload: null,
    onerror: null,
    status: outcome === 'http-error' ? 500 : 200,
    responseText: outcome === 'http-error' ? '{"error":{"code":500,"message":"Backend Error from googleapis"}}' : '',
  };
  xhr.send.mockImplementation(() => {
    if (outcome === 'success' || outcome === 'http-error') xhr.onload?.({} as ProgressEvent);
    if (outcome === 'network-error') xhr.onerror?.({} as ProgressEvent);
  });
  jest.spyOn(window, 'XMLHttpRequest').mockImplementation(() => xhr as unknown as XMLHttpRequest);
  return xhr;
}

function renderCamera(overrides: Partial<React.ComponentProps<typeof CameraCapture>> = {}) {
  return render(
    <CameraCapture
      guestName="Cyriel"
      shotsRemaining={25}
      shotCount={5}
      onUploadSuccess={jest.fn()}
      onEndSession={jest.fn()}
      {...overrides}
    />
  );
}

async function pickPhoto(name = 'photo.jpg') {
  const photoInput = document.querySelector('input[accept="image/*"]') as HTMLInputElement;
  await userEvent.upload(photoInput, new File(['data'], name, { type: 'image/jpeg' }));
}

afterEach(() => {
  jest.restoreAllMocks();
  (URL.revokeObjectURL as jest.Mock).mockClear();
});

describe('CameraCapture', () => {
  it('renders greeting with shots remaining', () => {
    render(
      <CameraCapture
        guestName="Cyriel"
        shotsRemaining={25}
        shotCount={5}
        onUploadSuccess={jest.fn()}
        onEndSession={jest.fn()}
      />
    );
    expect(screen.getByText(/Cyriel/)).toBeInTheDocument();
    expect(screen.getByText(/25 shots/i)).toBeInTheDocument();
  });

  it('renders Take Photo and Record Video buttons', () => {
    render(
      <CameraCapture
        guestName="Cyriel"
        shotsRemaining={25}
        shotCount={5}
        onUploadSuccess={jest.fn()}
        onEndSession={jest.fn()}
      />
    );
    expect(screen.getByRole('button', { name: /take photo/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record video/i })).toBeInTheDocument();
  });

  it('shows error when video file exceeds 100MB', async () => {
    render(
      <CameraCapture
        guestName="Cyriel"
        shotsRemaining={25}
        shotCount={5}
        onUploadSuccess={jest.fn()}
        onEndSession={jest.fn()}
      />
    );

    const videoInput = document.querySelector('input[accept="video/*"]') as HTMLInputElement;
    const bigFile = new File(['x'], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(bigFile, 'size', { value: 101 * 1024 * 1024 });

    await userEvent.upload(videoInput, bigFile);

    expect(screen.getByText(/video too large/i)).toBeInTheDocument();
  });

  it('shows Upload and Retake buttons after a valid file is selected', async () => {
    render(
      <CameraCapture
        guestName="Cyriel"
        shotsRemaining={25}
        shotCount={5}
        onUploadSuccess={jest.fn()}
        onEndSession={jest.fn()}
      />
    );

    const photoInput = document.querySelector('input[accept="image/*"]') as HTMLInputElement;
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });

    await userEvent.upload(photoInput, file);

    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retake/i })).toBeInTheDocument();
  });

  it('calls onUploadSuccess after successful upload', async () => {
    const onUploadSuccess = jest.fn();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ uploadUrl: 'https://upload.googleapis.com/mock', folderId: 'f1' }),
    }) as jest.Mock;

    const mockXhr = {
      open: jest.fn(),
      setRequestHeader: jest.fn(),
      send: jest.fn().mockImplementation(function (this: typeof mockXhr) {
        if (this.onload) this.onload({} as ProgressEvent);
      }),
      upload: { onprogress: null as unknown as (e: ProgressEvent) => void },
      onload: null as unknown as (e: ProgressEvent) => void,
      onerror: null as unknown as (e: ProgressEvent) => void,
      status: 200,
    };
    jest
      .spyOn(window, 'XMLHttpRequest')
      .mockImplementation(() => mockXhr as unknown as XMLHttpRequest);

    render(
      <CameraCapture
        guestName="Cyriel"
        shotsRemaining={25}
        shotCount={5}
        onUploadSuccess={onUploadSuccess}
        onEndSession={jest.fn()}
      />
    );

    const photoInput = document.querySelector('input[accept="image/*"]') as HTMLInputElement;
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    await userEvent.upload(photoInput, file);
    await userEvent.click(screen.getByRole('button', { name: /upload/i }));

    await waitFor(() => expect(onUploadSuccess).toHaveBeenCalled());
  });

  it('does not show the "I\'m done" link before any shots are taken', () => {
    render(
      <CameraCapture
        guestName="Cyriel"
        shotsRemaining={30}
        shotCount={0}
        onUploadSuccess={jest.fn()}
        onEndSession={jest.fn()}
      />
    );
    expect(screen.queryByText(/i'm done/i)).not.toBeInTheDocument();
  });

  it('shows the "I\'m done" link after at least one shot', () => {
    render(
      <CameraCapture
        guestName="Cyriel"
        shotsRemaining={25}
        shotCount={5}
        onUploadSuccess={jest.fn()}
        onEndSession={jest.fn()}
      />
    );
    expect(screen.getByText(/i'm done/i)).toBeInTheDocument();
  });

  it('shows an inline confirmation instead of a native dialog when "I\'m done" is tapped', async () => {
    render(
      <CameraCapture
        guestName="Cyriel"
        shotsRemaining={25}
        shotCount={5}
        onUploadSuccess={jest.fn()}
        onEndSession={jest.fn()}
      />
    );

    await userEvent.click(screen.getByText(/i'm done/i));

    expect(screen.getByText('End your film now with 5 shots?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /yes, end it/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onEndSession when the inline confirmation is accepted', async () => {
    const onEndSession = jest.fn();
    render(
      <CameraCapture
        guestName="Cyriel"
        shotsRemaining={25}
        shotCount={5}
        onUploadSuccess={jest.fn()}
        onEndSession={onEndSession}
      />
    );

    await userEvent.click(screen.getByText(/i'm done/i));
    await userEvent.click(screen.getByRole('button', { name: /yes, end it/i }));

    expect(onEndSession).toHaveBeenCalled();
  });

  it('does not call onEndSession and hides the confirmation when cancelled', async () => {
    const onEndSession = jest.fn();
    render(
      <CameraCapture
        guestName="Cyriel"
        shotsRemaining={25}
        shotCount={5}
        onUploadSuccess={jest.fn()}
        onEndSession={onEndSession}
      />
    );

    await userEvent.click(screen.getByText(/i'm done/i));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onEndSession).not.toHaveBeenCalled();
    expect(screen.queryByText('End your film now with 5 shots?')).not.toBeInTheDocument();
    expect(screen.getByText(/i'm done/i)).toBeInTheDocument();
  });

  it('clears the file input after a rejected file so the same file can be picked again', async () => {
    renderCamera();
    const videoInput = document.querySelector('input[accept="video/*"]') as HTMLInputElement;
    const bigFile = new File(['x'], 'big.mp4', { type: 'video/mp4' });
    Object.defineProperty(bigFile, 'size', { value: 101 * 1024 * 1024 });

    await userEvent.upload(videoInput, bigFile);

    expect(screen.getByText(/video too large/i)).toBeInTheDocument();
    expect(videoInput.value).toBe('');
  });

  it('does not use the disabled attribute on the Upload button while uploading (iOS drops nearby taps)', async () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;
    renderCamera();
    await pickPhoto();

    await userEvent.click(screen.getByRole('button', { name: /upload/i }));

    const uploadButton = screen.getByRole('button', { name: /uploading/i });
    expect(uploadButton).not.toBeDisabled();
    expect(uploadButton).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('starts only one upload when Upload is tapped twice', async () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;
    renderCamera();
    await pickPhoto();

    const uploadButton = screen.getByRole('button', { name: /upload/i });
    await userEvent.dblClick(uploadButton);
    await userEvent.click(screen.getByRole('button', { name: /uploading/i }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('hides Retake while an upload is in progress', async () => {
    global.fetch = jest.fn(() => new Promise(() => {})) as jest.Mock;
    renderCamera();
    await pickPhoto();

    await userEvent.click(screen.getByRole('button', { name: /upload/i }));

    expect(screen.queryByRole('button', { name: /retake/i })).not.toBeInTheDocument();
  });

  it('shows a friendly message (not the raw Drive response) when the upload fails, keeps the photo and does not use a shot', async () => {
    const onUploadSuccess = jest.fn();
    mockUploadSession();
    mockXhr('http-error');
    renderCamera({ onUploadSuccess });
    await pickPhoto();

    await userEvent.click(screen.getByRole('button', { name: /upload/i }));

    expect(
      await screen.findByText('Upload failed — check your connection and tap Upload to retry')
    ).toBeInTheDocument();
    expect(screen.queryByText(/backend error/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/500/)).not.toBeInTheDocument();
    expect(onUploadSuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('img', { name: 'Preview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^upload$/i })).toBeInTheDocument();
  });

  it('shows the same friendly message on a network error and lets the guest retry', async () => {
    const onUploadSuccess = jest.fn();
    mockUploadSession();
    mockXhr('network-error');
    renderCamera({ onUploadSuccess });
    await pickPhoto();

    await userEvent.click(screen.getByRole('button', { name: /upload/i }));
    expect(
      await screen.findByText('Upload failed — check your connection and tap Upload to retry')
    ).toBeInTheDocument();
    expect(onUploadSuccess).not.toHaveBeenCalled();

    mockXhr('success');
    await userEvent.click(screen.getByRole('button', { name: /^upload$/i }));
    await waitFor(() => expect(onUploadSuccess).toHaveBeenCalledTimes(1));
  });

  it('shows the friendly message when the upload session request fails', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Failed to create upload session', detail: 'invalid_grant' }),
    }) as jest.Mock;
    renderCamera();
    await pickPhoto();

    await userEvent.click(screen.getByRole('button', { name: /upload/i }));

    expect(
      await screen.findByText('Upload failed — check your connection and tap Upload to retry')
    ).toBeInTheDocument();
    expect(screen.queryByText(/invalid_grant/)).not.toBeInTheDocument();
  });

  it('shows an error when a photo exceeds 50MB and does not show the preview', async () => {
    renderCamera();
    const photoInput = document.querySelector('input[accept="image/*"]') as HTMLInputElement;
    const bigFile = new File(['x'], 'big.jpg', { type: 'image/jpeg' });
    Object.defineProperty(bigFile, 'size', { value: 51 * 1024 * 1024 });

    await userEvent.upload(photoInput, bigFile);

    expect(screen.getByText('Photo too large — try again')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Preview' })).not.toBeInTheDocument();
    expect(photoInput.value).toBe('');
  });

  it('accepts a photo of exactly 50MB', async () => {
    renderCamera();
    const photoInput = document.querySelector('input[accept="image/*"]') as HTMLInputElement;
    const file = new File(['x'], 'edge.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 50 * 1024 * 1024 });

    await userEvent.upload(photoInput, file);

    expect(screen.queryByText(/too large/i)).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Preview' })).toBeInTheDocument();
  });

  describe('when the upload session is rejected with a 4xx', () => {
    function mockRejectedSession(error: unknown) {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve(error),
      }) as jest.Mock;
    }

    it.each([
      ['Image too large', 'Photo too large — try again'],
      ['Video too large', 'Video too large — try a shorter clip'],
    ])('maps "%s" to a friendly, non-retry message', async (apiError, friendly) => {
      const onUploadSuccess = jest.fn();
      mockRejectedSession({ error: apiError });
      const xhrSpy = jest.spyOn(window, 'XMLHttpRequest');
      renderCamera({ onUploadSuccess });
      await pickPhoto();

      await userEvent.click(screen.getByRole('button', { name: /upload/i }));

      expect(await screen.findByText(friendly)).toBeInTheDocument();
      expect(screen.queryByText(/check your connection/i)).not.toBeInTheDocument();
      expect(onUploadSuccess).not.toHaveBeenCalled();
      expect(xhrSpy).not.toHaveBeenCalled();
    });

    it('shows a generic non-retry message for other 4xx errors without leaking the raw error', async () => {
      mockRejectedSession({ error: 'Unsupported file type' });
      renderCamera();
      await pickPhoto();

      await userEvent.click(screen.getByRole('button', { name: /upload/i }));

      expect(
        await screen.findByText("This file can't be uploaded — try retaking it")
      ).toBeInTheDocument();
      expect(screen.queryByText(/unsupported file type/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/check your connection/i)).not.toBeInTheDocument();
    });

    it('shows the generic non-retry message when the 4xx body is not JSON', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 413,
        json: () => Promise.reject(new SyntaxError('Unexpected token')),
      }) as jest.Mock;
      renderCamera();
      await pickPhoto();

      await userEvent.click(screen.getByRole('button', { name: /upload/i }));

      expect(
        await screen.findByText("This file can't be uploaded — try retaking it")
      ).toBeInTheDocument();
    });

    it('hides Upload but keeps Retake so the guest takes a new shot instead of retrying', async () => {
      mockRejectedSession({ error: 'Image too large' });
      renderCamera();
      await pickPhoto();

      await userEvent.click(screen.getByRole('button', { name: /upload/i }));
      await screen.findByText('Photo too large — try again');

      expect(screen.queryByRole('button', { name: /^upload$/i })).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /retake/i }));

      expect(screen.getByRole('button', { name: /take photo/i })).toBeInTheDocument();
      expect(screen.queryByText('Photo too large — try again')).not.toBeInTheDocument();
    });
  });

  it('revokes the preview object URL on retake', async () => {
    renderCamera();
    await pickPhoto();
    const url = screen.getByRole('img', { name: 'Preview' }).getAttribute('src');

    await userEvent.click(screen.getByRole('button', { name: /retake/i }));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('revokes the preview object URL after a successful upload', async () => {
    const onUploadSuccess = jest.fn();
    mockUploadSession();
    mockXhr('success');
    renderCamera({ onUploadSuccess });
    await pickPhoto();
    const url = screen.getByRole('img', { name: 'Preview' }).getAttribute('src');

    await userEvent.click(screen.getByRole('button', { name: /upload/i }));

    await waitFor(() => expect(onUploadSuccess).toHaveBeenCalled());
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('revokes the preview object URL on unmount', async () => {
    const { unmount } = renderCamera();
    await pickPhoto();
    const url = screen.getByRole('img', { name: 'Preview' }).getAttribute('src');

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  });

  it('clears the pending video-controls timer on unmount', async () => {
    jest.useFakeTimers();
    try {
      const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
      const { unmount } = renderCamera();
      const videoInput = document.querySelector('input[accept="video/*"]') as HTMLInputElement;
      await user.upload(videoInput, new File(['v'], 'clip.mp4', { type: 'video/mp4' }));
      const clearSpy = jest.spyOn(global, 'clearTimeout');
      const video = document.querySelector('video') as HTMLVideoElement;
      fireEvent.touchStart(video);
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      unmount();

      expect(clearSpy).toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
