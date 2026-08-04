// App settings, persisted to localStorage. Theme lives in $lib/theme and
// language in $lib/i18n.svelte — both need boot-script coordination that
// plain settings don't.

import { m } from './i18n.svelte';

/** Containers we can actually encode into — the choices a conversion has. */
export const CONVERT_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav'] as const;

/**
 * `best` is not a container: it means "keep whatever the site serves". Every
 * dropout and every clipped ending an mp3 can pick up comes from the re-encode
 * that choosing it skips, which is why it leads the list and is the default.
 */
export const AUDIO_FORMATS = ['best', ...CONVERT_FORMATS] as const;
export const VIDEO_FORMATS = ['mp4', 'webm', 'mkv'] as const;
export type MediaFormat =
	| (typeof AUDIO_FORMATS)[number]
	| (typeof VIDEO_FORMATS)[number];

export function formatKind(format: string): 'audio' | 'video' {
	return (VIDEO_FORMATS as readonly string[]).includes(format) ? 'video' : 'audio';
}

/** A container name is its own label; `best` is a promise and needs words. */
export function formatLabel(format: string): string {
	return format === 'best' ? m().home.formatBest : format;
}

/** Does this format put the file through a re-encode? Only then does quality mean anything. */
export function converts(format: string): boolean {
	return format !== 'best' && formatKind(format) === 'audio';
}

/** Values only — labels come from the i18n dictionary (m().quality). */
export const QUALITIES = ['best', '320', '192', '128'] as const;
export type Quality = (typeof QUALITIES)[number];

export const QUALITY_LABEL_KEYS: Record<Quality, 'best' | 'high' | 'standard' | 'small'> = {
	best: 'best',
	'320': 'high',
	'192': 'standard',
	'128': 'small'
};

interface Settings {
	format: MediaFormat;
	quality: Quality;
	autoUpdateYtdlp: boolean;
	/** Bumped when a default changes in a way old saves should follow. */
	v: number;
}

const KEY = 'mp3fy-settings';

const VERSION = 2;

const defaults: Settings = {
	format: 'best',
	quality: 'best',
	autoUpdateYtdlp: true,
	v: VERSION
};

function load(): Settings {
	try {
		// The raw object, before defaults are folded in: a save written by an
		// older version has no `v` at all, and reading it off the merged object
		// would read the current one back and migrate nothing.
		const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
		const saved: Settings = { ...defaults, ...raw };
		// mp3 used to be the default, and a default nobody chose should not
		// outlive the reason for it: converting every download to mp3 is what
		// put artefacts and clipped endings in the library. Anyone who picks
		// mp3 from here on keeps it — the marker is written the moment settings
		// are saved.
		if ((raw?.v ?? 0) < VERSION && saved.format === 'mp3') saved.format = 'best';
		saved.v = VERSION;
		return saved;
	} catch {
		return { ...defaults };
	}
}

export const settings = $state<Settings>(load());

export function saveSettings() {
	localStorage.setItem(KEY, JSON.stringify(settings));
}
