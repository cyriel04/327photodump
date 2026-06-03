# Wedding Photo Dump — Design Spec

**Date:** 2026-06-03  
**Project:** 327photodump  
**Stack:** Next.js 14 (App Router) + TypeScript, deployed to Vercel

---

## Overview

A mobile-first web app for wedding guests to capture and upload photos and short videos directly to the couple's Google Drive. Guests access the app via a QR code at the venue. No login required. Each guest gets their own subfolder in Drive. Upload count is capped at 30 per guest (disposable camera feel), tracked in localStorage.

---

## Architecture

### Stack
- **Framework:** Next.js 14 with App Router
- **Language:** TypeScript
- **Hosting:** Vercel
- **Storage:** Google Drive (via service account — no database)

### Google Drive Integration
- The couple creates a root folder in their Google Drive and shares it with a Google service account (write access)
- The app authenticates with Drive using the service account credentials stored as a Vercel environment variable
- When a guest uploads, the backend checks for / creates a subfolder named after the guest, then initiates a **resumable upload session** with Google Drive
- The client uploads the file **directly to Google Drive** using the resumable upload URL — bypassing Vercel's 4.5MB serverless body size limit

### Drive Folder Structure
```
📁 327 Photo Dump   (root folder, ID stored in env var)
  📁 Cyriel
    🖼 photo-2026-06-03T14-32-00.jpg
    🎥 video-2026-06-03T14-35-00.mp4
  📁 Maria
    🖼 photo-2026-06-03T15-10-00.jpg
```

### Environment Variables
| Variable | Description |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Full JSON key file content for the service account |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Google Drive folder ID of the couple's root folder |

### API Routes
| Route | Method | Purpose |
|---|---|---|
| `/api/upload-session` | POST | Creates guest subfolder if needed, returns resumable upload URL and upload metadata |

Request body:
```json
{
  "guestName": "Cyriel",
  "fileName": "photo-2026-06-03T14-32-00.jpg",
  "mimeType": "image/jpeg",
  "fileSize": 2048000
}
```

Response:
```json
{
  "uploadUrl": "https://www.googleapis.com/...",
  "folderId": "1abc..."
}
```

---

## UI & Components

### Application States

The app has three distinct states managed in `app/page.tsx`:

**State 1 — Name Entry** (shown on first visit or when no name is in localStorage)
- Wedding title / logo
- "What's your name?" prompt
- Required name/nickname text input
- "Start" button
- On submit: saves name to localStorage, transitions to State 2

**State 2 — Camera / Upload** (main experience)
- Greeting: `"Hi [Name]! 🎞 [N] shots left"`
- "Take Photo" button — opens native camera in photo mode
- "Record Video" button — opens native camera in video mode
- File preview (thumbnail shown after capture, before upload)
- Upload progress bar (shown during upload)
- Error message + retry button (shown on failure)
- Transitions to State 3 when shot count hits 0

**State 3 — Out of Film**
- "You're out of film!" heading
- "Thanks for capturing your POV 🎞" message
- No further actions

### Components
| File | Purpose |
|---|---|
| `app/page.tsx` | Orchestrates the three app states |
| `components/NameEntry.tsx` | Name input form |
| `components/CameraCapture.tsx` | Capture buttons, file input, preview, upload progress |
| `components/OutOfFilm.tsx` | End-of-shots screen |
| `lib/google-drive.ts` | Service account auth, folder lookup/creation, resumable upload session creation |
| `app/api/upload-session/route.ts` | API route: creates folder + returns resumable upload URL |

---

## Shot Limit (Disposable Camera)

- Each guest is limited to **30 uploads** (photos and videos combined)
- Count is tracked in **localStorage** under the key `shotCount_[name]` (e.g. `shotCount_Cyriel`)
- Count increments only on **successful upload** — failed uploads do not count
- The shot counter is displayed in the UI at all times during State 2
- When count reaches 30, the upload buttons are disabled and the app transitions to State 3
- The name field is locked to its initial value for the session (stored in localStorage)

**localStorage schema:**
```json
{
  "guestName": "Cyriel",
  "shotCount_Cyriel": 12
}
```

---

## File Handling

### Accepted Types
- Photos: `image/jpeg`, `image/png`, `image/heic`, `image/webp`
- Videos: `video/mp4`, `video/quicktime`, `video/webm`

### File Size Limit
- Videos capped at **100MB** — validated client-side before upload attempt
- Photos: no enforced limit (phone photos are typically 3–10MB)

### File Naming
Files are named with an ISO timestamp to avoid Drive filename collisions:
```
photo-2026-06-03T14-32-00.jpg
video-2026-06-03T14-35-00.mp4
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Upload fails (network drop) | Show "Upload failed — tap to retry". Shot count does not increment. |
| Video exceeds 100MB | Show "Video too large, try a shorter clip" before upload begins. |
| `/api/upload-session` fails | Show "No connection — please try again". |
| Two guests use the same name | They share a Drive subfolder (fine — Drive allows duplicate filenames). Their localStorage counts are independent, each gets 30 shots. |

---

## Guest Experience Summary

1. Guest scans QR code at the venue
2. Opens the web app on their phone
3. Types their name/nickname
4. Taps "Take Photo" or "Record Video" — native camera opens
5. Captures media, previews it in the app
6. Taps Upload — progress bar shows
7. Counter decrements: `"29 shots left"`
8. Repeat up to 30 times
9. App shows "You're out of film!" after the 30th upload

---

## Out of Scope

- Gallery / viewing uploaded media
- Admin moderation or approval
- Guest authentication (Google or otherwise)
- Push notifications
- Multi-wedding support
