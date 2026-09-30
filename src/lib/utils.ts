import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Accessible name for a gallery thumbnail button, e.g. "Open photo 3 of 12".
export function thumbnailLabel(file: { mimeType: string }, index: number, total: number): string {
  const kind = file.mimeType.startsWith("video/") ? "video" : "photo"
  return `Open ${kind} ${index + 1} of ${total}`
}
