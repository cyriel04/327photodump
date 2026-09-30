// Limits shared by the API (server-side validation) and the client (pre-checks
// and input constraints). Plain values only — safe to import from either side.

export const MAX_GUEST_NAME_LENGTH = 50;
export const MAX_FILE_NAME_LENGTH = 200;
export const MAX_IMAGE_SIZE = 50 * 1024 * 1024;
export const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
