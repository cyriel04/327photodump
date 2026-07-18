# End Film Early Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a guest voluntarily end their shooting session before reaching 30 shots, going straight to the Gallery.

**Architecture:** `useGuestSession` gains an `endSession()` function that sets `shotCount` to `MAX_SHOTS`, reusing the existing `isOutOfFilm = shotCount >= MAX_SHOTS` gate rather than adding a new flag. `CameraCapture` shows a small "I'm done" link once `shotCount > 0`, confirms via native `confirm()`, and calls `endSession()` through a new `onEndSession` prop wired in `page.tsx`.

**Tech Stack:** Next.js + TypeScript, React hooks, Jest + React Testing Library.

## Global Constraints

- `endSession()` must persist the same way `incrementShot` already does (via `lsSet`), so it survives a refresh.
- The "I'm done" control is hidden until at least one shot has been taken (`shotCount > 0`).
- Confirmation uses the native `confirm()` dialog with the exact current shot count in the message.
- `src/lib/use-guest-session.ts` is currently formatted with double quotes/tabs (a local, uncommitted style diff from the rest of the codebase) — match that file's existing style for any lines added to it rather than reformatting it.

---

### Task 1: Add `endSession` to the hook, wire an "I'm done" control into CameraCapture

**Files:**
- Modify: `src/lib/use-guest-session.ts`
- Modify: `src/__tests__/lib/use-guest-session.test.ts`
- Modify: `src/components/CameraCapture.tsx`
- Modify: `src/__tests__/components/CameraCapture.test.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Produces: `endSession(): void` returned from `useGuestSession()`.
- Produces: `CameraCapture` gains two new props — `shotCount: number` and `onEndSession: () => void`.

- [ ] **Step 1: Write the failing hook test**

Add to `src/__tests__/lib/use-guest-session.test.ts`:

```ts
  it('endSession sets shotCount to MAX_SHOTS and persists it', () => {
    const { result } = renderHook(() => useGuestSession());

    act(() => { result.current.setGuestName('Cyriel'); });
    act(() => { result.current.incrementShot(); });
    act(() => { result.current.endSession(); });

    expect(result.current.shotCount).toBe(30);
    expect(result.current.isOutOfFilm).toBe(true);
    expect(localStorage.getItem('shotCount_Cyriel')).toBe('30');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- use-guest-session.test.ts`
Expected: FAIL — `result.current.endSession is not a function`.

- [ ] **Step 3: Implement `endSession` in the hook**

In `src/lib/use-guest-session.ts`, add after `incrementShot` (matching the file's current double-quote/tab style):

```ts
	const endSession = () => {
		if (!guestName) return;
		lsSet(`shotCount_${guestName}`, String(MAX_SHOTS));
		setShotCount(MAX_SHOTS);
	};
```

And add `endSession` to the returned object:

```ts
	return {
		guestName,
		shotCount,
		shotsRemaining: MAX_SHOTS - shotCount,
		isOutOfFilm: shotCount >= MAX_SHOTS,
		setGuestName,
		incrementShot,
		endSession,
	};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- use-guest-session.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing CameraCapture tests**

Add to `src/__tests__/components/CameraCapture.test.tsx` (props signature grows to include `shotCount` and `onEndSession` — update every existing `render(<CameraCapture .../>)` call in the file to pass `shotCount={0}` and `onEndSession={jest.fn()}` alongside the existing props first, then add):

```ts
  it('does not show the "I\'m done" link before any shots are taken', () => {
    render(
      <CameraCapture guestName="Cyriel" shotsRemaining={30} shotCount={0} onUploadSuccess={jest.fn()} onEndSession={jest.fn()} />
    );
    expect(screen.queryByText(/i'm done/i)).not.toBeInTheDocument();
  });

  it('shows the "I\'m done" link after at least one shot', () => {
    render(
      <CameraCapture guestName="Cyriel" shotsRemaining={25} shotCount={5} onUploadSuccess={jest.fn()} onEndSession={jest.fn()} />
    );
    expect(screen.getByText(/i'm done/i)).toBeInTheDocument();
  });

  it('calls onEndSession when confirmed', async () => {
    const onEndSession = jest.fn();
    jest.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <CameraCapture guestName="Cyriel" shotsRemaining={25} shotCount={5} onUploadSuccess={jest.fn()} onEndSession={onEndSession} />
    );

    await userEvent.click(screen.getByText(/i'm done/i));

    expect(window.confirm).toHaveBeenCalledWith('End your film now with 5 shots?');
    expect(onEndSession).toHaveBeenCalled();
  });

  it('does not call onEndSession when the confirm is dismissed', async () => {
    const onEndSession = jest.fn();
    jest.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <CameraCapture guestName="Cyriel" shotsRemaining={25} shotCount={5} onUploadSuccess={jest.fn()} onEndSession={onEndSession} />
    );

    await userEvent.click(screen.getByText(/i'm done/i));

    expect(onEndSession).not.toHaveBeenCalled();
  });
```

- [ ] **Step 6: Run tests to verify the new ones fail**

Run: `npm test -- CameraCapture.test.tsx`
Expected: FAIL — `shotCount`/`onEndSession` props don't exist yet, no "I'm done" text rendered.

- [ ] **Step 7: Add the prop and control to CameraCapture**

In `src/components/CameraCapture.tsx`, update the `Props` interface:

```ts
interface Props {
  guestName: string;
  shotsRemaining: number;
  shotCount: number;
  onUploadSuccess: () => void;
  onEndSession: () => void;
}
```

Update the function signature:

```ts
export function CameraCapture({ guestName, shotsRemaining, shotCount, onUploadSuccess, onEndSession }: Props) {
```

Add a handler near the other handlers:

```ts
  const handleEndSession = () => {
    if (window.confirm(`End your film now with ${shotCount} shot${shotCount === 1 ? '' : 's'}?`)) {
      onEndSession();
    }
  };
```

Add the link in the `CardHeader`, right after the greeting paragraph:

```tsx
      <CardHeader className="pb-1 pt-4">
        <p className="text-base font-semibold text-amber-400">
          Hi {guestName}! 🎞 {shotsRemaining} shots left
        </p>
        {shotCount > 0 && (
          <button
            type="button"
            onClick={handleEndSession}
            className="text-xs text-muted-foreground underline self-start"
          >
            I&apos;m done — end film early
          </button>
        )}
      </CardHeader>
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npm test -- CameraCapture.test.tsx`
Expected: PASS

- [ ] **Step 9: Wire `shotCount` and `endSession` through `page.tsx`**

Replace the full contents of `src/app/page.tsx`:

```tsx
'use client';

import { useGuestSession } from '@/lib/use-guest-session';
import { NameEntry } from '@/components/NameEntry';
import { CameraCapture } from '@/components/CameraCapture';
import { Gallery } from '@/components/Gallery';

export default function Home() {
  const { guestName, shotCount, shotsRemaining, isOutOfFilm, setGuestName, incrementShot, endSession } =
    useGuestSession();

  if (!guestName) return <NameEntry onSubmit={setGuestName} />;
  if (isOutOfFilm) return <Gallery guestName={guestName} />;
  return (
    <CameraCapture
      guestName={guestName}
      shotsRemaining={shotsRemaining}
      shotCount={shotCount}
      onUploadSuccess={incrementShot}
      onEndSession={endSession}
    />
  );
}
```

- [ ] **Step 10: Run the full test suite and production build**

Run: `npm test`
Expected: PASS — all suites green (the 3 pre-existing `MAX_SHOTS`-dependent failures should be gone too, since `MAX_SHOTS` is back to 30 in the current working tree).

Run: `npm run build`
Expected: Build succeeds with no type errors.

- [ ] **Step 11: Commit**

```bash
git add src/lib/use-guest-session.ts src/__tests__/lib/use-guest-session.test.ts src/components/CameraCapture.tsx src/__tests__/components/CameraCapture.test.tsx src/app/page.tsx
git commit -m "feat: let guests end their film early before hitting 30 shots"
```
