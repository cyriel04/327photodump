# 327 Photo Dump

https://327photodump.vercel.app/

A mobile-first disposable camera app for weddings. Guests scan a QR code, type their name, and get 30 shots — photos or short videos — that upload directly to a shared Google Drive folder. No accounts, no app install, no friction.

Each guest gets their own subfolder. The couple gets everything in one place.

---

## How it works

1. Guest scans the QR code at the venue
2. Types their name or nickname
3. Taps "Take Photo" or "Record Video" — native camera opens
4. Previews the shot, taps Upload
5. Repeat up to 30 times
6. App shows "You're out of film!" — just like a disposable camera

Shot count is tracked in `localStorage` so it survives page refreshes. No server-side session needed.

---

## Tech

- **Next.js** (App Router) + TypeScript
- **shadcn/ui** + Tailwind CSS v4
- **Google Drive API v3** — resumable uploads
- **Vercel** — hosting

### The upload flow

Files never pass through the server. Here's why that matters and how it works:

Vercel serverless functions have a ~4.5 MB body limit. Phone photos easily exceed that. Instead:

1. Client asks the server to create a **resumable upload session** (`POST /api/upload-session`)
2. Server authenticates with Google Drive using an OAuth2 refresh token and returns a session URL
3. Client uploads the file **directly to Google Drive** via `XHR PUT` to that URL — no Vercel in the middle

The server forwards the client's `Origin` header when creating the session. Without it, Google doesn't enable CORS on the session URL and the browser upload fails silently.

### Why OAuth2, not a service account

Service accounts have no Google Drive storage quota. Files they create fail with:

```
403: Service Accounts do not have storage quota.
```

The fix is to authenticate as the actual Google account that owns the Drive folder, using a long-lived OAuth2 refresh token stored in environment variables.

---

## Running locally

```bash
npm install
npm run dev
```

You'll need a `.env.local` with these four variables:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_ROOT_FOLDER_ID=
```

See [Getting credentials](#getting-credentials) below.

To test on your phone over LAN, find your machine's local IP and open `http://192.168.x.x:3000`. The `allowedDevOrigins: ['*']` config in `next.config.ts` makes this work without Next.js blocking the cross-origin request.

---

## Getting credentials

### 1. Create an OAuth2 client

In [Google Cloud Console](https://console.cloud.google.com):

- Enable the **Google Drive API**
- Create an **OAuth 2.0 Client ID** (Web application type)
- Add `https://developers.google.com/oauthplayground` as an authorized redirect URI

### 2. Add yourself as a test user

APIs & Services → OAuth consent screen → Test users → add your Gmail address. Without this you get `403: access_denied` in the next step.

### 3. Get a refresh token

Go to [OAuth Playground](https://developers.google.com/oauthplayground):

- Gear icon → "Use your own OAuth credentials" → paste your Client ID and Secret
- Select scope: `https://www.googleapis.com/auth/drive`
- Authorize → Exchange authorization code for tokens → copy the **Refresh token**

### 4. Get the folder ID

Create a folder in Google Drive. Copy the ID from the URL:
`https://drive.google.com/drive/folders/THIS_IS_THE_ID`

---

## Deployment

```bash
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
vercel env add GOOGLE_REFRESH_TOKEN
vercel env add GOOGLE_DRIVE_ROOT_FOLDER_ID

vercel --prod
```

### Debug route

`/api/debug` checks each step of the auth chain — env vars, token exchange, folder read, folder write, and resumable session creation. Useful for diagnosing issues without digging into logs. The folder ID is partially redacted in the output.

---

## Tests

```bash
npm test
```

22 tests across 6 suites covering the Drive library, API route, localStorage hook, and all three components.

---

## iOS quirks worth knowing

Mobile Safari has a few behaviours that broke the app during development:

- **`disabled` buttons** — iOS drops taps on elements near a disabled button. The Start button uses Tailwind opacity classes instead of the `disabled` prop.
- **`<form>` elements** — submitting a form refreshes the page on iOS. The name entry uses `type="button"` + `onClick` instead.
- **`autoFocus`** — opens the keyboard immediately on load, pushing the submit button off-screen. Removed.
- **`localStorage` in Private Browsing** — Safari throws on any `localStorage` access. All calls are wrapped in try/catch with an in-memory fallback.
