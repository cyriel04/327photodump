# 327 Photo Dump

[![CI](https://github.com/cyriel04/327photodump/actions/workflows/ci.yml/badge.svg)](https://github.com/cyriel04/327photodump/actions/workflows/ci.yml)

**Live:** https://327photodump.vercel.app/

A mobile-first disposable camera app for weddings. Guests scan a QR code, type their name, and get 30 shots — photos or short videos — that upload straight from their phone to a shared Google Drive folder. No accounts, no app install, no friction.

Each guest gets their own subfolder. The couple gets everything in one place.

---

## How it works

1. Guest scans the QR code at the venue
2. Types their name or nickname
3. Taps **Take Photo** or **Record Video** — the phone's native camera opens
4. Previews the shot, taps **Upload** (with a progress bar)
5. Repeats up to 30 times — or taps **"I'm done — end film early"**
6. The app shows **"You're out of film!"** — just like a disposable camera

When the film is finished, the guest gets a gallery:

- **My Shots** — a grid of everything they uploaded
- **Feed** — swipe through other guests' shots, one guest at a time, most recently active first
- **Lightbox** — full-screen viewer with swipe, arrow keys and Escape; videos play in Google's Drive player

Shot count is tracked in `localStorage` so it survives page refreshes. No accounts and no server-side session.

### Names, sharing and limits

- **A name is the guest's identity.** Guests who type the same name share one Drive folder and one "My Shots" gallery. If two phones create the same name at the exact same moment and Drive ends up with two same-name folders, the app treats them as one: new uploads always go to the oldest folder, "My Shots" lists files from all of them, and the feed shows the name once.
- The feed hides guests whose name matches your own (your shots are under "My Shots").
- Names are trimmed and limited to **50 characters**. Photos are limited to **50 MB** and videos to **100 MB**. The app checks before uploading and the server enforces the same limits — both read [`src/lib/upload-limits.ts`](src/lib/upload-limits.ts).
- The 30-shot limit is enforced on the phone only (in `localStorage`), not on the server.

---

## Tech

- **Next.js 16** (App Router) + TypeScript + React 19
- **shadcn/ui** + Tailwind CSS v4
- **Google Drive API v3** — resumable uploads, OAuth2 refresh token
- **Jest** + React Testing Library, **ESLint** (`eslint-config-next`)
- **GitHub Actions** CI, **Vercel** hosting

### Project structure

```
src/
  app/
    page.tsx                  # NameEntry → CameraCapture → Gallery
    api/
      upload-session/         # POST: create a resumable Drive upload session
      gallery/guest/          # GET: one guest's files (all same-name folders)
      gallery/feed/           # GET: guests ordered by most recent shot
      debug/                  # GET: auth-chain diagnostics (locked in production)
      _lib/validation.ts      # request validation (private folder, not a route)
  components/                 # NameEntry, CameraCapture, Gallery, MyShotsGrid,
                              # FeedScreen, Lightbox, Thumbnail, ui/ (shadcn)
  lib/
    google-drive.ts           # server-only Drive access
    use-guest-session.ts      # name + shot count, localStorage with fallback
    upload-limits.ts          # limits shared by client and server
  types/index.ts              # API request/response shapes
  __tests__/                  # api/, components/, lib/
```

### API

| Route | Method | Returns |
| --- | --- | --- |
| `/api/upload-session` | `POST` `{ guestName, fileName, mimeType, fileSize }` | `{ uploadUrl, folderId }` · `400` on invalid input · `500` on Drive failure |
| `/api/gallery/guest?guestName=` | `GET` | `{ files }` newest first, `[]` for an unknown guest (never creates a folder) |
| `/api/gallery/feed` | `GET` | `{ guests }` one entry per name, most recent first |
| `/api/debug` | `GET` | Auth-chain checks; `404` in production unless `?token=` matches `DEBUG_TOKEN` |

Error responses carry a generic `error` message only — raw Drive errors are logged server-side, never returned.

### The upload flow

Files never pass through the server. Vercel serverless functions have a ~4.5 MB body limit and phone photos easily exceed that. Instead:

1. Client asks the server to create a **resumable upload session** (`POST /api/upload-session`)
2. Server validates the request, finds or creates the guest's folder, authenticates with Google Drive using an OAuth2 refresh token, and returns a session URL
3. Client uploads the file **directly to Google Drive** via `XHR PUT` to that URL — no Vercel in the middle
4. Only a successful upload uses up a shot. Network failures can be retried; files the server rejects (too large, wrong type) prompt a retake.

The server forwards the client's `Origin` header when creating the session. Without it, Google doesn't enable CORS on the session URL and the browser upload fails silently.

### Why OAuth2, not a service account

Service accounts have no Google Drive storage quota. Files they create fail with:

```
403: Service Accounts do not have storage quota.
```

The fix is to authenticate as the actual Google account that owns the Drive folder, using a long-lived OAuth2 refresh token stored in environment variables.

### Security notes

- Google credentials and tokens stay on the server; `src/lib/google-drive.ts` is never imported by client code.
- Guest input is escaped before it goes into Drive search queries (names like `O'Brien` work, and can't widen a query).
- Guest folders are shared as **anyone-with-the-link: reader** so thumbnails load. The root folder is never made public. If sharing a new folder fails, it's moved to trash so the next upload retries cleanly.
- Uploads are restricted to `image/*` and `video/*` within the size limits, so the endpoint can't be used as general file hosting.
- `NEXT_PUBLIC_GOOGLE_API_KEY` is **visible in the browser by design**. It can read any "anyone with the link" Drive file (including the guest folders), never the private root, so it exposes nothing that wasn't already link-readable. Restrict it to the **Google Drive API only** — that's the real safeguard. The HTTP-referrer restriction stops other websites embedding it, but any non-browser client can fake a Referer. Abuse at worst hits Drive's free, capped quota (403s), and the lightbox then falls back to Drive's player.

---

## Running locally

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

`.env.local` needs:

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_ROOT_FOLDER_ID=
DEBUG_TOKEN=            # optional, only used in production
NEXT_PUBLIC_GOOGLE_API_KEY=   # optional; without it videos play in Drive's iframe player
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

While the consent screen's publishing status is **Testing**, Google expires refresh tokens after 7 days and uploads start failing with `Upload session error: invalid_grant`. To stop that, click **Publish app** on the consent screen (you can ignore the "unverified app" warning for your own account), then get a new refresh token in step 3.

### 3. Get a refresh token

Go to [OAuth Playground](https://developers.google.com/oauthplayground):

- Gear icon → "Use your own OAuth credentials" → paste your Client ID and Secret
- Select scope: `https://www.googleapis.com/auth/drive`
- Authorize → Exchange authorization code for tokens → copy the **Refresh token**

### 4. Get the folder ID

Create a folder in Google Drive. Copy the ID from the URL:
`https://drive.google.com/drive/folders/THIS_IS_THE_ID`

### 5. Get an API key (for video playback)

APIs & Services → Credentials → **Create credentials → API key**, then edit the key:

- Application restrictions → **HTTP referrers**: `https://<prod-domain>/*` and `http://localhost:3000/*` (add `http://192.168.x.x:3000/*` to test from your phone over LAN, and your `*.vercel.app` domain if you use preview deployments — otherwise those fall back to Drive's player)
- API restrictions → **Restrict key** → **Google Drive API** only

Without the key, the lightbox falls back to Drive's `/preview` player.

---

## Deployment

Vercel deploys **only from `main`** — [`vercel.json`](vercel.json) turns off automatic deployments for every other branch, so feature branches don't create preview deployments. Merging a PR to `main` ships to production.

Set the environment variables once:

```bash
vercel env add GOOGLE_CLIENT_ID
vercel env add GOOGLE_CLIENT_SECRET
vercel env add GOOGLE_REFRESH_TOKEN
vercel env add GOOGLE_DRIVE_ROOT_FOLDER_ID
vercel env add DEBUG_TOKEN   # optional — only if you want /api/debug in production
vercel env add NEXT_PUBLIC_GOOGLE_API_KEY   # optional — native video playback; inlined at build time, so redeploy after changing it
```

A manual `vercel --prod` from your machine still works if you need it.

### Debug route

`/api/debug` checks each step of the auth chain — env vars, token exchange, folder read, folder write, and resumable session creation. Useful for diagnosing issues without digging into logs. The folder ID is partially redacted in the output.

Because it creates and deletes a test folder and opens an upload session, the route is locked down in production: it returns `404` unless a `DEBUG_TOKEN` env var is set **and** the request passes it as a query param, e.g. `/api/debug?token=<your DEBUG_TOKEN>` (compared in constant time). Leave `DEBUG_TOKEN` unset to disable the route entirely in production. In local development (`npm run dev`) it's open with no token.

---

## Tests, lint and CI

```bash
npm test            # Jest + React Testing Library
npm run lint        # ESLint with eslint-config-next (core-web-vitals + typescript)
npx tsc --noEmit    # typecheck
npm run build
```

Jest suites cover the Drive library (with `googleapis` and `fetch` mocked — tests never call real Drive), every API route, request validation, the localStorage hook, and the UI components.

[CI](.github/workflows/ci.yml) runs lint → typecheck → tests → build on every PR to `main` and every push to `main`. The `build` check is **required** — a PR can't merge until it passes and the branch is up to date with `main`.

---

## Contributing

- **Every change goes on its own branch** — `feature/<slug>` or `fix/<slug>` — and reaches `main` through a PR that passes CI.
- The repo ships three [Claude Code](https://claude.com/claude-code) subagents in [`.claude/agents/`](.claude/agents/), with project rules in [`AGENTS.md`](AGENTS.md):
  - **`frontend-dev`** — pages, components, client hooks, styling
  - **`backend-dev`** — API routes and Google Drive access
  - **`reviewer`** — read-only review for secret leaks, upload-flow and iOS regressions, test quality
- This is Next.js 16 — APIs differ from older versions. Check `node_modules/next/dist/docs/` before relying on memory.

---

## iOS quirks worth knowing

Mobile Safari has a few behaviours that broke the app during development:

- **`disabled` buttons** — iOS drops taps on elements near a disabled button. Buttons use Tailwind opacity classes instead; the Upload button also has a ref guard so a double-tap can't start two uploads.
- **`<form>` elements** — submitting a form refreshes the page on iOS. The name entry uses `type="button"` + `onClick` instead.
- **`autoFocus`** — opens the keyboard immediately on load, pushing the submit button off-screen. Removed.
- **`localStorage` in Private Browsing** — Safari throws on any `localStorage` access. All calls are wrapped in try/catch with an in-memory fallback.
- **Video previews** — need `playsInline` to play inline instead of jumping to fullscreen. Keep `controls` always on: toggling it on touch makes iOS stack a second play button over the control bar.
- **Re-picking the same file** — the file input is reset after each pick, otherwise choosing the same file again (e.g. after a "too large" error) fires no change event.
- **Drive video playback** — Drive's direct file links block cross-origin loading, so the lightbox shows photos from an upsized thumbnail. Videos play in a native `<video>` straight from `googleapis.com/drive/v3/files/<id>?alt=media&key=…`, which allows CORS and Range requests, so iOS shows only its own controls. They don't go through our API: Vercel's response cap forced small sequential chunks and playback stalled. With no key, a type the browser can't play, or a playback error, the lightbox falls back to Drive's `/preview` iframe (whose controls stack with iOS's).
