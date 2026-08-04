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
	fileExists,
	isTauri,
	onJobEvents,
	startDownload,
	type ProgressEvent,
	type VideoInfo
} from './api';
import { addToHistory, history, type HistoryEntry } from './history.svelte';
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
	/**
	 * A link that has already produced a file still on disk, waiting for the
	 * user to say whether to fetch it again. The dialog lives in the layout,
	 * not on Home: a shared link can land on any screen.
	 */
	duplicate: { url: string; entry: HistoryEntry } | null;
}

export const download = $state<DownloadState>({
	url: '',
	busy: false,
	progress: null,
	error: null,
	finished: null,
	format: settings.format,
	kind: formatKind(settings.format),
	queued: [],
	duplicate: null
});

/** Title/artist/thumbnail for the running job — not rendered until it lands. */
let info: VideoInfo | null = null;
/** The link the running job came from; `download.url` is cleared when it lands. */
let source: string | null = null;
let subscribed = false;

/**
 * Two links are the same download when they name the same thing — not when
 * they are the same string. Sharing from an app adds a tracking parameter,
 * copying from the address bar adds a trailing slash, and neither means
 * "fetch it again". Anything beyond that (youtu.be against watch?v=) is left
 * alone: the prompt asks rather than decides, so a miss costs a question and
 * never a wrong answer.
 */
const NOISE = /^(utm_|si$|feature$|fbclid$|gclid$|igsh$|igshid$)/;

function normalizeLink(raw: string): string {
	const link = raw.trim();
	try {
		const url = new URL(link);
		url.hash = '';
		// Only the host is case-insensitive. A video id is not: `youtu.be/dQw4`
		// and `youtu.be/DQW4` are two different videos, and folding their case
		// together would answer "you already have this" about something the
		// user has never seen.
		url.protocol = url.protocol.toLowerCase();
		url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
		for (const key of [...url.searchParams.keys()]) {
			if (NOISE.test(key)) url.searchParams.delete(key);
		}
		return url.toString().replace(/\/$/, '');
	} catch {
		return link.replace(/\/$/, '');
	}
}

/**
 * The file this link already produced, if it is still there. A history row
 * whose file someone has since deleted is not a reason to ask anything.
 */
async function alreadyHave(url: string): Promise<HistoryEntry | null> {
	const wanted = normalizeLink(url);
	const entry = history.entries.find((e) => e.url && normalizeLink(e.url) === wanted);
	if (!entry) return null;
	return (await fileExists(entry.path).catch(() => false)) ? entry : null;
}

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
				// What actually came back, not what was asked for: Android
				// falls back to the site's own audio format when it cannot
				// run ffmpeg, and the library should not call an m4a an mp3.
				// The kind is still whatever was requested — an audio-only
				// webm is audio, however much the extension suggests video.
				const ext = f.path.split('.').pop()?.toLowerCase();
				download.finished = addToHistory({
					path: f.path,
					format: ext && ext.length <= 4 ? ext : download.format,
					kind: download.kind,
					size: f.size,
					artist: info?.uploader ?? null,
					thumbnail: info?.thumbnail ?? null,
					// Kept so the same link asks before downloading twice.
					url: source
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

export async function startJob(opts: { force?: boolean } = {}): Promise<void> {
	const url = download.url.trim();
	if (!url || download.busy) return;

	// Ask before fetching something the library already has. `force` is the
	// answer coming back from that question, and the only way past it.
	if (!opts.force) {
		const previous = await alreadyHave(url);
		if (previous) {
			download.duplicate = { url, entry: previous };
			return;
		}
	}
	download.duplicate = null;
	source = url;

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
		// A launch-by-link can be delivered twice — once as the event, once by
		// `getCurrent` — and re-sharing what is already downloading means the
		// same thing: this is the running job, not a second one.
		if (link === download.url) return 'started';
		if (!download.queued.includes(link)) download.queued.push(link);
		return 'queued';
	}
	download.url = link;
	download.finished = null;
	download.error = null;
	void startJob();
	return 'started';
}

/** "Download it again" — the one path past the duplicate question. */
export function redownload(): void {
	const pending = download.duplicate;
	download.duplicate = null;
	if (!pending) return;
	download.url = pending.url;
	void startJob({ force: true });
}

/**
 * "Keep what I have." The link is dropped rather than left in the field: it
 * has been answered, and a queue behind it must still drain — a shared link
 * waiting on a question nobody asked for would strand every link after it.
 */
export function keepExisting(): void {
	if (!download.duplicate) return;
	download.duplicate = null;
	download.url = '';
	drainQueue();
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
	download.duplicate = null;
	download.queued.length = 0;
	info = null;
	source = null;
}
