# Wedding Photo Dump — Design Spec

**Date:** 2026-06-03  
**Project:** 327photodump  
**Stack:** Next.js (App Router) + TypeScript, deployed to Vercel

---

## Overview

A mobile-first web app for wedding guests to capture and upload photos and short videos directly to the couple's Google Drive. Guests access the app via a QR code at the venue. No login required. Each guest gets their own subfolder in Drive. Upload count is capped at 30 per guest (disposable camera feel), tracked in localStorage.

---

## Architecture

### Stack
- **Framework:** Next.js with App Router (current installed version — check `node_modules/next/dist/docs/` for actual API)
- **Language:** TypeScript
- **UI:** shadcn/ui components + Tailwind CSS v4
- **Font:** Geist via `next/font/google`
- **Hosting:** Vercel
- **Storage:** Google Drive (personal account via OAuth2 — no database)

### Google Drive Integration

**Why OAuth2, not a service account:**  
Service accounts have no Google Drive storage quota. Any file a service account creates fails with `403: Service Accounts do not have storage quota`. The solution is to authenticate as the real Google account that owns the Drive folder — using OAuth2 with a long-lived refresh token stored in Vercel env vars.

**Upload flow:**
1. Client calls `POST /api/upload-session` with guest name, file name, MIME type, and file size
2. Server uses OAuth2 to find or create a guest subfolder in the root Drive folder
3. Server calls Google's resumable upload API to create a session, passing the client's `Origin` header so Google enables CORS on the returned URL
4. Server returns the session URL to the client
5. Client uploads the file **directly to Google Drive** via XHR PUT — bypassing Vercel's 4.5MB serverless body size limit

**Why the `Origin` header matters:**  
If the session is created server-side without an `Origin` header, Google does not set `Access-Control-Allow-Origin` on the session URI. The browser's cross-origin PUT is then blocked (fires `xhr.onerror`, not `xhr.onload`). Forwarding the client's `Origin` in the session-creation POST fixes this.

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
| `GOOGLE_CLIENT_ID` | OAuth2 client ID from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth2 client secret from Google Cloud Console |
| `GOOGLE_REFRESH_TOKEN` | Long-lived refresh token obtained via OAuth Playground |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Google Drive folder ID of the couple's root folder |

### API Routes
| Route | Method | Purpose |
|---|---|---|
| `/api/upload-session` | POST | Creates guest subfolder if needed; returns resumable upload URL |
| `/api/debug` | GET | Diagnostic: tests auth, folder read, write access, and session creation |

`/api/upload-session` request body:
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

The app has three distinct states managed in `src/app/page.tsx`:

**State 1 — Name Entry** (shown on first visit or when no name is in localStorage)
- Wedding title
- "What's your name?" prompt
- Required name/nickname text input (no `autoFocus` — pushes button off-screen on iOS)
- "Start" button — styled with Tailwind opacity instead of `disabled` prop (iOS drops taps near disabled buttons)
- No `<form>` element — uses `type="button"` + `onClick` + `onKeyDown` to avoid iOS page refresh on submit
- On submit: saves name to localStorage, transitions to State 2

**State 2 — Camera / Upload** (main experience)
- Greeting: `"Hi [Name]! 🎞 [N] shots left"`
- "Take Photo" button — opens native camera in photo mode
- "Record Video" button — opens native camera in video mode, with "Keep it under 60 seconds" sub-label
- File preview (thumbnail shown after capture, before upload)
- Upload progress bar (shown during upload)
- Error message (shown on failure — includes Google API error text for diagnosability)
- Transitions to State 3 when shot count hits 0

**State 3 — Out of Film**
- "You're out of film!" heading
- "Thanks for capturing your POV 🎞" message
- No further actions

### Components
| File | Purpose |
|---|---|
| `src/app/page.tsx` | Orchestrates the three app states |
| `src/app/layout.tsx` | Root layout — dark mode, Geist font, viewport export |
| `src/components/NameEntry.tsx` | Name input — no `<form>`, no `disabled`, no `autoFocus` (iOS fixes) |
| `src/components/CameraCapture.tsx` | Capture buttons, preview, progress bar, direct XHR upload to Drive |
| `src/components/OutOfFilm.tsx` | End-of-shots screen |
| `src/lib/google-drive.ts` | OAuth2 auth, folder lookup/creation, resumable upload session creation |
| `src/lib/use-guest-session.ts` | Custom hook: guest name + shot count via localStorage |
| `src/app/api/upload-session/route.ts` | API route: creates folder + returns resumable upload URL |
| `src/app/api/debug/route.ts` | Diagnostic route — remove before sharing publicly |

---

## Shot Limit (Disposable Camera)

- Each guest is limited to **30 uploads** (photos and videos combined)
- Count is tracked in **localStorage** under the key `shotCount_[name]` (e.g. `shotCount_Cyriel`)
- Safari Private Browsing blocks localStorage — use try/catch with an in-memory `Record<string, string>` fallback
- Count increments only on **successful upload** — failed uploads do not count
- The shot counter is displayed in the UI at all times during State 2
- The name field is locked to its initial value for the session (stored in localStorage)

**localStorage schema:**
```json
{
  "guestName": "Cyriel",
  "shotCount_Cyriel": "12"
}
```

---

## File Handling

### Accepted Types
- Photos: `image/*` (JPEG, PNG, HEIC, WebP — whatever the device camera produces)
- Videos: `video/*` (MP4, MOV, WebM)

### Size Limits
- Videos capped at **100 MB** — validated client-side before upload attempt
- Suggested video length: **under 60 seconds** (displayed in the UI)
- Photos: no enforced limit (phone photos are typically 3–10 MB)

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
| Upload fails (network/CORS) | Show "Upload failed — network error". Shot count does not increment. |
| Upload rejected by Google (4xx) | Show "Upload failed (403): [Google error text]". Shot count does not increment. |
| Video exceeds 100 MB | Show "Video too large — try a shorter clip" before upload begins. |
| `/api/upload-session` fails | Show "Failed to get upload URL" with detail from server response. |
| Two guests use the same name | They share a Drive subfolder (fine — Drive allows duplicate filenames). localStorage counts are independent; each gets 30 shots. |

---

## iOS-Specific Notes

These issues were encountered and fixed during development:

| Issue | Fix |
|---|---|
| Taps near `disabled` buttons dropped on iOS | Remove `disabled` prop; simulate disabled with Tailwind opacity classes |
| `<form>` submit refreshes the page on iOS | Remove `<form>`; use `type="button"` + `onClick` + `onKeyDown` for Enter |
| `autoFocus` pushes button off-screen (virtual keyboard opens immediately) | Remove `autoFocus` from the name input |
| IP address access breaks interactivity on mobile | Add `allowedDevOrigins: ['*']` in `next.config.ts` |
| Viewport not set → touch coordinates misalign | Export `viewport` from `layout.tsx` (Next.js `Viewport` type) |
| Safari Private Browsing throws on `localStorage` | Wrap all localStorage calls in try/catch with in-memory fallback |

---

## Development Setup

### LAN Access (testing on phone)
`next.config.ts` must include:
```ts
const nextConfig: NextConfig = {
  allowedDevOrigins: ['*'],
};
```

### Viewport
`src/app/layout.tsx` must export a `Viewport` — not a `<meta>` tag (Next.js manages this):
```ts
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};
```

### Jest
`jest.config.js` requires an explicit `moduleNameMapper` for `@/` path aliases — `next/jest` does not auto-map tsconfig paths:
```js
moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' }
```

---

## Google Cloud / OAuth2 Setup

1. **Create an OAuth2 Client ID** in Google Cloud Console → APIs & Services → Credentials → Web application
2. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI
3. **Get a refresh token** via [OAuth Playground](https://developers.google.com/oauthplayground):
   - Gear icon → Use your own OAuth credentials → paste Client ID + Secret
   - Select scope: `https://www.googleapis.com/auth/drive`
   - Authorize with the Google account that owns the Drive folder
   - Exchange authorization code → copy Refresh token
4. **Add the account as a test user** in OAuth consent screen (required while the app is unverified)
5. Store `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_DRIVE_ROOT_FOLDER_ID` in Vercel env vars

---

## Out of Scope

- Gallery / viewing uploaded media
- Admin moderation or approval
- Guest authentication (Google or otherwise)
- Push notifications
- Multi-wedding support
