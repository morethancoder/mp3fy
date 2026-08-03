/**
 * Links handed to mp3fy by another app.
 *
 * Every desktop OS delivers this the same way in the end — as a URL with our
 * own scheme, `mp3fy://…` — but by two different routes: macOS wakes the
 * running app with an `Opened` event, while Windows and Linux launch a second
 * copy with the URL as an argument, which the single-instance plugin forwards
 * to the copy already running (see `src-tauri/src/lib.rs`). The deep-link
 * plugin papers over both, so this module only has to answer one question:
 * where inside that URL is the actual video link?
 *
 * A share sheet or a bookmarklet can wrap it in any of the shapes below, so
 * all of them are accepted:
 *
 *   mp3fy://https://youtu.be/xyz
 *   mp3fy://open?url=https%3A%2F%2Fyoutu.be%2Fxyz
 *   https://youtu.be/xyz          (a bare link, e.g. an Android SEND intent)
 *
 * Whatever comes in, the result is the same as pasting it on Home and
 * pressing Get: the download starts by itself.
 */

import { goto } from '$app/navigation';
import { isTauri, logEvent } from './api';
import { startWithUrl } from './downloads.svelte';
import { m } from './i18n.svelte';

/**
 * `https` (or `http`) followed by however much of `://` survived the trip.
 *
 * It is not always all of it: hand macOS `mp3fy://https://youtu.be/x` and the
 * app is woken with `mp3fy://https//youtu.be/x` — normalising the URL eats the
 * inner colon. Matching the separator loosely and rebuilding it is what makes
 * the obvious way of writing these links work.
 */
const HTTP_LINK = /(https?)[:/]{0,3}([^\s"'<>]*\.[^\s"'<>]+)/i;

/** The http(s) link buried in a shared URL, or null if there isn't one. */
export function extractLink(raw: string): string | null {
	const text = raw?.trim();
	if (!text) return null;

	const candidates = [text];

	// mp3fy://open?url=… — the link rides in a query parameter, encoded.
	try {
		const params = new URL(text).searchParams;
		for (const key of ['url', 'text', 'link', 'q']) {
			const value = params.get(key);
			if (value) candidates.unshift(value);
		}
	} catch {
		// not parseable as a URL on its own; the scan below still works
	}

	// mp3fy://https%3A%2F%2F… — some senders encode the whole payload.
	try {
		candidates.push(decodeURIComponent(text));
	} catch {
		// malformed escape sequence — nothing to add
	}

	for (const candidate of candidates) {
		const match = HTTP_LINK.exec(candidate);
		if (!match) continue;
		// A trailing `)` or `.` is punctuation from the message it was copied
		// out of, never part of the link.
		const rest = match[2].replace(/[).,;]+$/, '');
		const link = `${match[1].toLowerCase()}://${rest}`;
		// A still-encoded payload can match the pattern and mean nothing, so
		// the first candidate that names a real host wins, not the first that
		// matches the shape.
		if (hasHost(link)) return link;
	}
	return null;
}

function hasHost(link: string): boolean {
	try {
		return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(new URL(link).hostname);
	} catch {
		return false;
	}
}

/** Act on one delivery — possibly several links at once. */
function accept(urls: string[]): void {
	let taken = 0;
	for (const raw of urls) {
		const link = extractLink(raw);
		if (!link) {
			logEvent('share', `ignored (no link inside): ${raw}`);
			continue;
		}
		taken++;
		logEvent('share', `received ${link}`);
		const outcome = startWithUrl(link);
		window.mtui?.toast(
			outcome === 'queued' ? m().home.sharedQueued : m().home.sharedStarted
		);
	}
	// Land on the screen that shows the progress bar the link just started.
	if (taken > 0) void goto('/');
}

/**
 * Subscribe once, from the layout. Also picks up the link that launched the
 * app, which on Windows and Linux is a command-line argument rather than an
 * event — `getCurrent` is what makes a cold start behave like a warm one.
 */
export async function initSharedLinks(): Promise<void> {
	if (!isTauri) return;
	const { getCurrent, onOpenUrl } = await import('@tauri-apps/plugin-deep-link');

	try {
		await onOpenUrl(accept);
	} catch (e) {
		logEvent('share', `could not listen for shared links: ${e}`);
	}

	try {
		const launched = await getCurrent();
		if (launched?.length) accept(launched);
	} catch (e) {
		logEvent('share', `could not read the launch link: ${e}`);
	}
}
