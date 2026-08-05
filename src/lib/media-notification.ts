/**
 * The Android notification player.
 *
 * `$lib/player` already tells `navigator.mediaSession` everything about the
 * current track, and on desktop that is the whole job: the webview hands it to
 * the OS and the track appears on the Now Playing surface, with media keys
 * wired up. **Android's WebView implements the same API and publishes none of
 * it.** Chrome shows a media notification for a web page because the browser
 * wraps the page's session in a native one; a WebView has no browser around
 * it, so on the one platform where a notification player really matters, the
 * API bought us nothing.
 *
 * So the state is pushed across to a native MediaSession instead
 * (`MediaService.kt`), and every button pressed there comes back as a
 * `media:action` event. The frontend stays the only thing that knows what
 * "next" means — Android is handed a picture of the player, never control of
 * it.
 *
 * The commands are no-ops on desktop, so nothing here needs a caller to
 * branch; the platform check is only to save the round trip.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isAndroid, isTauri, logEvent } from './api';

/** Exactly what `platform::MediaState` deserialises. */
export interface MediaState {
	title: string;
	artist: string;
	album: string;
	artwork: string | null;
	playing: boolean;
	/** Seconds, both — `duration` is 0 until the file has been read. */
	position: number;
	duration: number;
	shuffle: boolean;
	repeat: 'off' | 'all' | 'one';
	canNext: boolean;
	canPrevious: boolean;
}

export type MediaActionName =
	| 'play'
	| 'pause'
	| 'toggle'
	| 'next'
	| 'previous'
	| 'stop'
	| 'seek'
	| 'shuffle'
	| 'repeat';

export interface MediaAction {
	action: MediaActionName;
	/** Seconds, on `seek` and nowhere else. */
	position?: number | null;
}

const native = isTauri && isAndroid;

/**
 * The last state sent. Position moves constantly while a track plays, and the
 * system extrapolates it from the timestamp of the last update — so this is
 * pushed on the handful of moments that actually change the picture (a track,
 * a pause, a seek), not on every `timeupdate`, and identical states are
 * dropped rather than sent twice.
 */
let sent = '';

export function publishMedia(state: MediaState) {
	if (!native) return;
	const key = JSON.stringify(state);
	if (key === sent) return;
	sent = key;
	void invoke('show_media_notification', { state }).catch((e: unknown) => {
		logEvent('player', `the media notification could not be updated: ${e}`);
	});
}

export function hideMedia() {
	if (!native) return;
	sent = '';
	void invoke('hide_media_notification').catch(() => {
		// The notification outliving playback by a moment is not worth a log
		// line; the service takes itself down with the app either way.
	});
}

/** Wire the buttons back to the player. Called once, with the audio element. */
export function onMediaAction(handler: (action: MediaAction) => void) {
	if (!native) return;
	void listen<MediaAction>('media:action', (e) => handler(e.payload)).catch((e: unknown) => {
		logEvent('player', `the media notification's buttons are not connected: ${e}`);
	});
}
