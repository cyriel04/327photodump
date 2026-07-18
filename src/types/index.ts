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

export interface GalleryFile {
  id: string;
  mimeType: string;
  thumbnailLink: string | null;
  viewUrl: string;
  createdTime: string;
}

export interface GalleryFeedEntry {
  guestName: string;
  coverThumbnail: string | null;
  mostRecentTime: string;
}
