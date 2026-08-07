/**
 * One app-wide audio engine. The <audio> element lives at module level, not
 * in the player page, so playback survives navigation between tabs. The
 * Media Session hookup is what puts the track on the OS media surface —
 * media keys and Now Playing on desktop — wherever the webview supports it,
 * which on Android is nowhere: the notification player there is native, and
 * `$lib/media-notification` is how this module drives it.
 */

import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { isTauri, logEvent } from './api';
import { history, incrementPlays, type HistoryEntry } from './history.svelte';
import { m } from './i18n.svelte';
import {
	hideMedia,
	onMediaAction,
	publishMedia,
	type MediaAction
} from './media-notification';

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

/**
 * Start playback and swallow the one rejection that means nothing.
 *
 * `play()` returns a promise the browser rejects with AbortError whenever
 * something interrupts the attempt — loading the next track, or a pause a few
 * milliseconds later. Left as `void audio.play()` those rejections went
 * unhandled, which the layout's `unhandledrejection` hook dutifully wrote to
 * the Logs screen: two "The play() request was interrupted by a call to
 * pause()" lines for every track change, and no way to tell them apart from a
 * failure that actually mattered. Anything else is a real problem and is
 * logged as one.
 */
function begin(a: HTMLAudioElement) {
	a.play().catch((e: unknown) => {
		if (e instanceof DOMException && e.name === 'AbortError') return;
		logEvent('player', `could not start playback: ${e}`);
	});
}

/* ---- Getting the bytes to the element ----

   The obvious way — point <audio> at `convertFileSrc(path)` and let it stream
   — is broken on Android, and quietly. A media element asks for its resource
   with `Range: bytes=0-`, and Tauri's asset protocol answers a range request
   with at most 1000 KiB (`MAX_LEN` in tauri/src/protocol/asset.rs). A desktop
   webview then asks for the next range, and the next; Android's does not. Its
   custom-scheme responses come back through `shouldInterceptRequest` as a
   single WebResourceResponse, so the 1 MB is everything the player will ever
   get: playback stopped partway with the transport still claiming to play,
   always at the same place, and seeking past it hung forever.

   The answer used to be to read the file in full and play it from a `blob:`
   URL — correct for a three-minute song, hopeless for an hour of recitation,
   which is a couple of hundred megabytes of webview heap before the first
   sample and a `PIPELINE_ERROR_READ` when it does not fit.

   So the bytes now come over HTTP from a loopback server in Rust
   (`src-tauri/src/media.rs`), which speaks Range properly. That is not a
   custom scheme, so it goes through the platform's own network stack, and
   every webview — Android's included — streams it and seeks by asking for the
   range it wants. Nothing is held in memory. */

/** Bumped by every load, stop included: a slow read must not win a later race. */
let attaching = 0;

async function load(a: HTMLAudioElement, entry: HistoryEntry) {
	const token = ++attaching;
	let src: string;
	try {
		src = await invoke<string>('media_url', { path: entry.path });
	} catch (e) {
		// Only the server streams. Falling back to the asset protocol keeps
		// desktop working and gets Android its first megabyte — enough to hear
		// that something is wrong, with the reason sitting above it in the log.
		logEvent('player', `no stream for ${entry.path} (${e}) — using the asset protocol`);
		src = convertFileSrc(entry.path);
	}
	if (token !== attaching) return; // another track was picked meanwhile
	a.src = src;
	begin(a);
}

function engine(): HTMLAudioElement {
	if (audio) return audio;
	audio = new Audio();
	audio.volume = player.volume;
	audio.addEventListener('timeupdate', () => {
		player.currentTime = audio!.currentTime;
		updatePositionState();
	});
	audio.addEventListener('durationchange', () => {
		player.duration = audio!.duration || 0;
		// The length is what puts a scrubber on the notification, and it is only
		// known once enough of the file has been read.
		publish();
	});
	audio.addEventListener('play', () => {
		player.playing = true;
		setSessionState('playing');
		publish();
	});
	audio.addEventListener('pause', () => {
		player.playing = false;
		setSessionState('paused');
		publish();
	});
	// Android extrapolates the playhead from the last state it was given, so a
	// jump has to be announced; the steady ticking does not.
	audio.addEventListener('seeked', publish);
	audio.addEventListener('ended', () => {
		if (player.repeat === 'one') {
			seek(0);
			begin(audio!);
			return;
		}
		step(1, true);
	});
	// A file that will not decode used to look like the player stopping for no
	// reason: silence, a play button that did nothing, and nothing in the logs
	// naming the file. MEDIA_ERR_SRC_NOT_SUPPORTED (4) is the usual one — a
	// container the webview cannot open, or a file truncated by a download that
	// died in post-processing.
	audio.addEventListener('error', () => {
		// ✕ empties the element on purpose; that is not a failure to report.
		if (!player.current) return;
		const err = audio?.error;
		player.playing = false;
		// No `pause` event follows a load that failed, so without this the
		// notification is left insisting it is playing a file that never
		// started — with a pause button that does nothing.
		publish();
		logEvent(
			'player',
			`playback failed (code ${err?.code ?? '?'}${err?.message ? `: ${err.message}` : ''}) — ${player.current?.path ?? 'no file'}`
		);
		window.mtui?.toast(m().player.failed, { kind: 'error' });
	});
	wireMediaSession();
	wireNotification();
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
	// Same track: it is already loaded, this is just a resume.
	if (player.current?.id === entry.id) {
		begin(a);
		return;
	}
	player.current = entry;
	player.currentTime = 0;
	player.duration = 0;
	setMetadata(entry);
	incrementPlays(entry.id);
	void load(a, entry);
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
	// Any read still in flight belongs to a track nobody is listening to now.
	attaching++;
	if (audio) {
		audio.pause();
		audio.removeAttribute('src');
		audio.load(); // drop the buffer and the connection, not just the playhead
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
	hideMedia();
}

export function expand() {
	if (player.current) player.expanded = true;
}

export function toggle() {
	if (!audio || !player.current) return;
	// Nothing to resume while the file is still being read; the load starts
	// playback itself when it lands.
	if (!audio.src) return;
	if (audio.paused) begin(audio);
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
	publish();
}

export function setRepeat(mode: RepeatMode) {
	player.repeat = mode;
	persistPrefs();
	publish();
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

/* ---- The Android notification player ----

   Everything above is the web API, and on Android it publishes nothing: its
   WebView implements `navigator.mediaSession` and hands none of it to the
   system, so the phone — where a notification player matters most — showed no
   controls at all. `$lib/media-notification` pushes the same picture over to a
   native MediaSession instead, and the buttons come back here.

   Position is deliberately not pushed on every tick. Android extrapolates the
   playhead from the timestamp of the last state it was given, so the handful
   of moments that genuinely change the picture — a track, a pause, a seek, a
   length becoming known — are enough, and a per-frame IPC is not. */

/**
 * A number Rust will accept. `JSON.stringify` writes NaN and Infinity as
 * `null`, which fails the command's deserialisation outright — and a media
 * element hands out both: a duration is NaN before metadata arrives and
 * Infinity for anything of unknown length.
 */
function seconds(value: number | undefined): number {
	return Number.isFinite(value) ? (value as number) : 0;
}

function publish() {
	const entry = player.current;
	if (!entry) return hideMedia();
	const list = playable();
	publishMedia({
		title: entry.title,
		artist: entry.artist ?? 'mp3fy',
		album: entry.format.toUpperCase(),
		artwork: entry.thumbnail,
		playing: player.playing,
		position: seconds(audio?.currentTime),
		duration: seconds(player.duration),
		shuffle: player.shuffle,
		repeat: player.repeat,
		// One track is still a queue; it is just one you cannot step out of.
		canNext: list.length > 1,
		canPrevious: list.length > 1
	});
}

/** Play, without the ambiguity of a toggle arriving from somewhere else. */
function resume() {
	if (!audio || !audio.src) return;
	if (audio.paused) begin(audio);
}

/** The order the player's own options menu offers, cycled by one button. */
function nextRepeat(mode: RepeatMode): RepeatMode {
	return mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';
}

function wireNotification() {
	onMediaAction(({ action, position }: MediaAction) => {
		switch (action) {
			case 'play':
				resume();
				break;
			case 'pause':
				audio?.pause();
				break;
			case 'toggle':
				toggle();
				break;
			case 'next':
				next();
				break;
			case 'previous':
				previous();
				break;
			// Swiping the notification away is how a paused player is dismissed
			// from outside the app — the same thing the ✕ does inside it.
			case 'stop':
				stop();
				break;
			case 'seek':
				if (position != null) seek(position);
				break;
			case 'shuffle':
				toggleShuffle();
				break;
			case 'repeat':
				setRepeat(nextRepeat(player.repeat));
				break;
			default:
				logEvent('player', `unknown media action: ${action}`);
		}
	});
}
