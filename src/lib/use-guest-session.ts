"use client";

import { useState, useEffect } from "react";

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
		if (storedName) {
			const count = readShotCount(storedName);
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
