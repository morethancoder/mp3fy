// User-made playlists: named, ordered lists of history entry ids.

export interface Playlist {
	id: string;
	name: string;
	ids: string[];
}

const KEY = 'mp3fy-playlists';

function load(): Playlist[] {
	try {
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return Array.isArray(raw) ? raw : [];
	} catch {
		return [];
	}
}

export const playlists = $state<{ lists: Playlist[] }>({ lists: load() });

function persist() {
	localStorage.setItem(KEY, JSON.stringify(playlists.lists));
}

export function createPlaylist(name: string): Playlist {
	const list: Playlist = { id: crypto.randomUUID(), name: name.trim(), ids: [] };
	playlists.lists = [...playlists.lists, list];
	persist();
	return list;
}

export function deletePlaylist(id: string) {
	playlists.lists = playlists.lists.filter((l) => l.id !== id);
	persist();
}

export function toggleInPlaylist(listId: string, entryId: string) {
	const list = playlists.lists.find((l) => l.id === listId);
	if (!list) return;
	list.ids = list.ids.includes(entryId)
		? list.ids.filter((i) => i !== entryId)
		: [...list.ids, entryId];
	persist();
}
