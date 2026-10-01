import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Shown when /api/* returns 401: the guest_access cookie is missing or expired
// (tab opened before the gate shipped, or Safari data cleared). Deliberately says
// nothing about the access code itself.
export const ACCESS_EXPIRED_MESSAGE = "Your access expired — scan the QR code at the venue again"

// Accessible name for a gallery thumbnail button, e.g. "Open photo 3 of 12".
export function thumbnailLabel(file: { mimeType: string }, index: number, total: number): string {
  const kind = file.mimeType.startsWith("video/") ? "video" : "photo"
  return `Open ${kind} ${index + 1} of ${total}`
}
