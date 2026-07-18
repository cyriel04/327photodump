import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CameraCapture } from '@/components/CameraCapture';

// jsdom doesn't implement URL.createObjectURL
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

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
});
