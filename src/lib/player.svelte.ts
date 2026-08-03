/**
 * One app-wide audio engine. The <audio> element lives at module level, not
 * in the player page, so playback survives navigation between tabs. The
 * Media Session hookup is what puts the track on the OS media surface —
 * lock-screen / notification player on mobile, media keys and Now Playing
 * on desktop — wherever the webview supports it.
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import { isTauri } from './api';
import { history, incrementPlays, type HistoryEntry } from './history.svelte';

export type RepeatMode = 'off' | 'all' | 'one';

/** Toggles worth remembering between launches — not the transport state. */
const PREFS_KEY = 'mp3fy-player';

interface Prefs {
	shuffle: boolean;
	repeat: RepeatMode;
	/** 0–1. There is no separate mute: a slider at zero is silence. */
	volume: number;
}

function loadPrefs(): Prefs {
	const defaults: Prefs = { shuffle: false, repeat: 'off', volume: 1 };
	try {
		const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
		const prefs = { ...defaults, ...raw };
		if (prefs.repeat !== 'all' && prefs.repeat !== 'one') prefs.repeat = 'off';
		if (typeof prefs.volume !== 'number' || !Number.isFinite(prefs.volume)) prefs.volume = 1;
		prefs.volume = Math.max(0, Math.min(1, prefs.volume));
		return prefs;
	} catch {
		return defaults;
	}
}

const prefs = loadPrefs();

export const player = $state<{
	current: HistoryEntry | null;
	playing: boolean;
	currentTime: number;
	duration: number;
	/** Big-player overlay open? Closing it leaves the mini player docked. */
	expanded: boolean;
	/** Entry ids next/previous walk through — the list playback started from. */
	queue: string[];
	shuffle: boolean;
	repeat: RepeatMode;
	volume: number;
}>({
	current: null,
	playing: false,
	currentTime: 0,
	duration: 0,
	expanded: false,
	queue: [],
	shuffle: prefs.shuffle,
	repeat: prefs.repeat,
	volume: prefs.volume
});

function persistPrefs() {
	try {
		localStorage.setItem(
			PREFS_KEY,
			JSON.stringify({ shuffle: player.shuffle, repeat: player.repeat, volume: player.volume })
		);
	} catch {
		// private browsing — the toggles just won't survive a relaunch
	}
}

let audio: HTMLAudioElement | null = null;

function engine(): HTMLAudioElement {
	if (audio) return audio;
	audio = new Audio();
	audio.volume = player.volume;
	audio.addEventListener('timeupdate', () => {
		player.currentTime = audio!.currentTime;
		updatePositionState();
	});
	audio.addEventListener('durationchange', () => (player.duration = audio!.duration || 0));
	audio.addEventListener('play', () => {
		player.playing = true;
		setSessionState('playing');
	});
	audio.addEventListener('pause', () => {
		player.playing = false;
		setSessionState('paused');
	});
	audio.addEventListener('ended', () => {
		if (player.repeat === 'one') {
			seek(0);
			void audio!.play();
			return;
		}
		step(1, true);
	});
	wireMediaSession();
	return audio;
}

function playable(): HistoryEntry[] {
	if (player.queue.length > 0) {
		const byId = new Map(history.entries.map((e) => [e.id, e]));
		const queued = player.queue
			.map((id) => byId.get(id))
			.filter((e): e is HistoryEntry => !!e && e.kind === 'audio');
		if (queued.length > 0) return queued;
	}
	return history.entries.filter((e) => e.kind === 'audio');
}

/**
 * Load and play, without touching the overlay. Auto-advance goes through
 * here: a track ending while the mini player is docked must not throw the
 * full-screen player over whatever the user was doing.
 */
function start(entry: HistoryEntry, queue?: HistoryEntry[]) {
	if (!isTauri) return;
	const a = engine();
	if (queue) player.queue = queue.map((e) => e.id);
	if (player.current?.id !== entry.id) {
		player.current = entry;
		player.currentTime = 0;
		player.duration = 0;
		a.src = convertFileSrc(entry.path);
		setMetadata(entry);
		incrementPlays(entry.id);
	}
	void a.play();
}

/** Play on purpose — from a list row or a finished download. Opens the player. */
export function play(entry: HistoryEntry, queue?: HistoryEntry[]) {
	start(entry, queue);
	if (isTauri) player.expanded = true;
}

export function collapse() {
	player.expanded = false;
}

/**
 * Dismiss the player entirely: silence, and the mini dock goes away with the
 * bottom of the screen back to the content. Collapsing only hides the
 * overlay, so without this there is no way to put the drawer down again.
 */
export function stop() {
	if (audio) {
		audio.pause();
		audio.removeAttribute('src');
		audio.load(); // drop the decoded buffer, not just the playhead
	}
	player.current = null;
	player.playing = false;
	player.currentTime = 0;
	player.duration = 0;
	player.expanded = false;
	player.queue = [];
	if (sessionAvailable()) {
		navigator.mediaSession.metadata = null;
		navigator.mediaSession.playbackState = 'none';
	}
}

export function expand() {
	if (player.current) player.expanded = true;
}

export function toggle() {
	if (!audio || !player.current) return;
	if (audio.paused) void audio.play();
	else audio.pause();
}

export function seek(seconds: number) {
	if (!audio) return;
	audio.currentTime = Math.max(0, Math.min(seconds, player.duration || seconds));
}

export function skip(delta: number) {
	if (audio) seek(audio.currentTime + delta);
}

export function next() {
	step(1);
}

export function previous() {
	// The universal convention: early in a track, go to the previous one;
	// later, restart the current track.
	if (audio && audio.currentTime > 3) return seek(0);
	step(-1);
}

export function toggleShuffle() {
	player.shuffle = !player.shuffle;
	persistPrefs();
}

export function setRepeat(mode: RepeatMode) {
	player.repeat = mode;
	persistPrefs();
}

export function setVolume(value: number) {
	player.volume = Math.max(0, Math.min(1, value));
	if (audio) audio.volume = player.volume;
	persistPrefs();
}

/** `auto` marks the move as "the track ended", not "the user asked". */
function step(direction: 1 | -1, auto = false) {
	const list = playable();
	if (!player.current || list.length === 0) return;
	const i = list.findIndex((e) => e.id === player.current!.id);

	if (player.shuffle && list.length > 1) {
		let j = i;
		while (j === i) j = Math.floor(Math.random() * list.length);
		return start(list[j]);
	}

	const target = list[i + direction];
	if (target) return start(target);
	// Walked off the end: wrap when repeating the list, otherwise stop.
	if (player.repeat === 'all') {
		return start(direction === 1 ? list[0] : list[list.length - 1]);
	}
	if (auto || direction === 1) audio?.pause();
	else seek(0);
}

/* ---- Media Session: the OS-level player surface ---- */

function sessionAvailable(): boolean {
	return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
}

function setMetadata(entry: HistoryEntry) {
	if (!sessionAvailable()) return;
	navigator.mediaSession.metadata = new MediaMetadata({
		title: entry.title,
		artist: entry.artist ?? 'mp3fy',
		album: entry.format.toUpperCase(),
		artwork: entry.thumbnail ? [{ src: entry.thumbnail }] : []
	});
}

function setSessionState(state: 'playing' | 'paused') {
	if (sessionAvailable()) navigator.mediaSession.playbackState = state;
}

function updatePositionState() {
	if (!sessionAvailable() || !audio || !Number.isFinite(audio.duration)) return;
	try {
		navigator.mediaSession.setPositionState({
			duration: audio.duration,
			playbackRate: audio.playbackRate,
			position: audio.currentTime
		});
	} catch {
		// some webviews reject partial position states — cosmetic only
	}
}

function wireMediaSession() {
	if (!sessionAvailable()) return;
	const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
		['play', () => toggle()],
		['pause', () => toggle()],
		['previoustrack', () => previous()],
		['nexttrack', () => next()],
		['seekbackward', () => skip(-10)],
		['seekforward', () => skip(10)],
		['seekto', (d) => d.seekTime != null && seek(d.seekTime)]
	];
	for (const [action, handler] of handlers) {
		try {
			navigator.mediaSession.setActionHandler(action, handler);
		} catch {
			// action not supported on this platform — fine
		}
	}
}
