// Everything the app has produced, newest first, persisted to localStorage.

import { titleFromPath } from './format';

export interface HistoryEntry {
	id: string;
	title: string;
	path: string;
	format: string;
	kind: 'audio' | 'video';
	size: number | null;
	date: string; // ISO
	artist: string | null;
	thumbnail: string | null;
	plays: number;
}

const KEY = 'mp3fy-history';

function load(): HistoryEntry[] {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		if (!Array.isArray(raw)) return [];
		// Entries written before artist/thumbnail/plays existed get defaults.
		return raw.map((e) => ({ artist: null, thumbnail: null, plays: 0, ...e }));
	} catch {
		return [];
	}
}

export const history = $state<{ entries: HistoryEntry[] }>({ entries: load() });

function persist() {
	localStorage.setItem(KEY, JSON.stringify(history.entries));
}

export function addToHistory(opts: {
	path: string;
	format: string;
	kind: 'audio' | 'video';
	size: number | null;
	artist?: string | null;
	thumbnail?: string | null;
}): HistoryEntry {
	const entry: HistoryEntry = {
		id: crypto.randomUUID(),
		title: titleFromPath(opts.path),
		path: opts.path,
		format: opts.format,
		kind: opts.kind,
		size: opts.size,
		date: new Date().toISOString(),
		artist: opts.artist ?? null,
		thumbnail: opts.thumbnail ?? null,
		plays: 0
	};
	// Re-downloading the same file replaces the old row instead of stacking.
	history.entries = [entry, ...history.entries.filter((e) => e.path !== entry.path)];
	persist();
	return entry;
}

export function removeFromHistory(id: string) {
	history.entries = history.entries.filter((e) => e.id !== id);
	persist();
}

export function incrementPlays(id: string) {
	const entry = history.entries.find((e) => e.id === id);
	if (!entry) return;
	entry.plays += 1;
	persist();
}
