export interface UploadSessionRequest {
  guestName: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface UploadSessionResponse {
  uploadUrl: string;
  folderId: string;
}
