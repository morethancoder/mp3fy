/**
 * The download job, hoisted out of the Home screen.
 *
 * yt-dlp always ran detached in Rust, so leaving the tab never stopped a
 * download — but the event subscription and every scrap of progress state
 * used to live in the Home component's `onMount`, so navigating away threw
 * the result on the floor: no history row, no toast, and a progress bar that
 * restarted from nothing when you came back. This module subscribes once for
 * the lifetime of the app, which is what makes "start it and go browse"
 * actually work, whether the app is in another tab or in the background.
 */

import {
	cancelDownload,
	fetchInfo,
	isTauri,
	onJobEvents,
	startDownload,
	type ProgressEvent,
	type VideoInfo
} from './api';
import { addToHistory, type HistoryEntry } from './history.svelte';
import { chime } from './feedback';
import { m } from './i18n.svelte';
import { formatKind, settings, type MediaFormat, type Quality } from './settings.svelte';

export interface DownloadState {
	/** The pasted link. Lives here so the field survives a tab change too. */
	url: string;
	busy: boolean;
	progress: ProgressEvent | null;
	error: string | null;
	finished: HistoryEntry | null;
	/** Snapshot of the settings the running job started with. */
	format: MediaFormat;
	kind: 'audio' | 'video';
	/** Links shared while a job was running; they start as this one drains. */
	queued: string[];
}

export const download = $state<DownloadState>({
	url: '',
	busy: false,
	progress: null,
	error: null,
	finished: null,
	format: settings.format,
	kind: formatKind(settings.format),
	queued: []
});

/** Title/artist/thumbnail for the running job — not rendered until it lands. */
let info: VideoInfo | null = null;
let subscribed = false;

/**
 * One download at a time is a yt-dlp/ffmpeg constraint, but share three links
 * in a row and silently dropping two would be the wrong answer — they wait in
 * `download.queued` (which the Home screen counts) and start as it drains.
 */
function drainQueue(): void {
	if (download.busy) return;
	const next = download.queued.shift();
	if (next) {
		download.url = next;
		void startJob();
	}
}

/** Subscribe once, from the layout. Later calls are no-ops (HMR, remounts). */
export function initDownloads(): void {
	if (!isTauri || subscribed) return;
	subscribed = true;
	onJobEvents('download', {
		progress: (e) => {
			// A cancelled job can still have a line or two in flight; those
			// must not put the screen back into a running state.
			if (!download.busy) return;
			download.progress = e;
		},
		done: (f) => {
			download.busy = false;
			download.progress = null;
			if (f.path) {
				download.finished = addToHistory({
					path: f.path,
					format: download.format,
					kind: download.kind,
					size: f.size,
					artist: info?.uploader ?? null,
					thumbnail: info?.thumbnail ?? null
				});
				// The link has done its job — clear it so the next paste lands
				// in an empty field instead of on top of the old one.
				download.url = '';
				download.error = null;
			}
			// No `kind` on the toast: that would fire MTUI's success cue on
			// top of our own, longer completion chime.
			window.mtui?.toast(m().home.saved);
			chime();
			drainQueue();
		},
		error: (message) => {
			download.busy = false;
			download.progress = null;
			download.error = message;
			drainQueue();
		}
	});
}

export async function startJob(): Promise<void> {
	const url = download.url.trim();
	if (!url || download.busy) return;

	download.format = settings.format;
	download.kind = formatKind(settings.format);
	download.error = null;
	download.finished = null;
	download.busy = true;
	download.progress = { stage: 'preparing', percent: null, size: null, speed: null, eta: null };

	// Metadata rides alongside the download rather than gating it — it only
	// has to arrive before the `done` event writes the history row.
	info = null;
	const quality: Quality = settings.quality;
	fetchInfo(url)
		.then((i) => (info = i))
		.catch(() => {});

	try {
		await startDownload({ url, format: download.format, quality, kind: download.kind });
	} catch (e) {
		download.busy = false;
		download.progress = null;
		download.error = String(e);
	}
}

/**
 * Take a link the user did not type here — shared from another app — and act
 * on it the way a paste followed by "Get" would. Returns what happened so the
 * caller can say so.
 */
export function startWithUrl(url: string): 'started' | 'queued' {
	const link = url.trim();
	if (download.busy) {
		if (!download.queued.includes(link)) download.queued.push(link);
		return 'queued';
	}
	download.url = link;
	download.finished = null;
	download.error = null;
	void startJob();
	return 'started';
}

/**
 * Cancel means stop, not "skip to the next one" — the waiting links are on
 * screen while this runs, so dropping them here is what the button says.
 */
export async function cancelJob(): Promise<void> {
	await cancelDownload();
	download.busy = false;
	download.progress = null;
	download.queued.length = 0;
}

export function clearJob(): void {
	download.url = '';
	download.error = null;
	download.finished = null;
	download.queued.length = 0;
	info = null;
}
