"use client";

import { useState, useEffect } from "react";
import { MAX_GUEST_NAME_LENGTH } from "@/lib/upload-limits";

const MAX_SHOTS = 30;

// Safari Private Browsing throws a SecurityError on any localStorage access.
// Fall back to an in-memory store so the app still works.
const store: Record<string, string> = {};

function lsGet(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return store[key] ?? null;
	}
}

function lsSet(key: string, value: string): void {
	try {
		localStorage.setItem(key, value);
	} catch {
		store[key] = value;
	}
}

function lsRemove(key: string): void {
	try {
		localStorage.removeItem(key);
	} catch {
		// Fall through — the in-memory copy below is cleared either way.
	}
	delete store[key];
}

// The API rejects names that are blank or longer than MAX_GUEST_NAME_LENGTH, so a
// stored name like that would make every upload fail. Treat it as absent.
function isUsableGuestName(name: string): boolean {
	const trimmed = name.trim();
	return trimmed.length > 0 && trimmed.length <= MAX_GUEST_NAME_LENGTH;
}

// A stored count can be corrupted (edited, truncated, written by an older build).
// Anything that isn't a sane integer is treated as 0; values are clamped to MAX_SHOTS.
function readShotCount(name: string): number {
	const parsed = parseInt(lsGet(`shotCount_${name}`) ?? "0", 10);
	if (!Number.isFinite(parsed) || parsed < 0) return 0;
	return Math.min(parsed, MAX_SHOTS);
}

export function useGuestSession() {
	const [guestName, setGuestNameState] = useState<string | null>(null);
	const [shotCount, setShotCount] = useState(0);

	useEffect(() => {
		const storedName = lsGet("guestName");
		if (storedName !== null && !isUsableGuestName(storedName)) {
			// Send the guest back to NameEntry instead of locking them out.
			lsRemove("guestName");
			return;
		}
		if (storedName) {
			const count = readShotCount(storedName);
			// localStorage is only readable after hydration; reading it in a useState
			// initialiser would make the server and client render differently.
			// eslint-disable-next-line react-hooks/set-state-in-effect
			setGuestNameState(storedName);
			setShotCount(count);
		}
	}, []);

	const setGuestName = (name: string) => {
		lsSet("guestName", name);
		const count = readShotCount(name);
		setGuestNameState(name);
		setShotCount(count);
	};

	const incrementShot = () => {
		if (!guestName) return;
		const newCount = Math.min(shotCount + 1, MAX_SHOTS);
		lsSet(`shotCount_${guestName}`, String(newCount));
		setShotCount(newCount);
	};

	const endSession = () => {
		if (!guestName) return;
		lsSet(`shotCount_${guestName}`, String(MAX_SHOTS));
		setShotCount(MAX_SHOTS);
	};

	return {
		guestName,
		shotCount,
		shotsRemaining: MAX_SHOTS - shotCount,
		isOutOfFilm: shotCount >= MAX_SHOTS,
		setGuestName,
		incrementShot,
		endSession,
	};
}
