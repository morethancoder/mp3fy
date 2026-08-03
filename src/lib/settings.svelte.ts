// App settings, persisted to localStorage. Theme lives in $lib/theme and
// language in $lib/i18n.svelte — both need boot-script coordination that
// plain settings don't.

export const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'flac', 'wav'] as const;
export const VIDEO_FORMATS = ['mp4', 'webm', 'mkv'] as const;
export type MediaFormat =
	| (typeof AUDIO_FORMATS)[number]
	| (typeof VIDEO_FORMATS)[number];

export function formatKind(format: string): 'audio' | 'video' {
	return (VIDEO_FORMATS as readonly string[]).includes(format) ? 'video' : 'audio';
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
}

const KEY = 'mp3fy-settings';

const defaults: Settings = {
	format: 'mp3',
	quality: 'best',
	autoUpdateYtdlp: true
};

function load(): Settings {
	try {
		return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
	} catch {
		return { ...defaults };
	}
}

export const settings = $state<Settings>(load());

export function saveSettings() {
	localStorage.setItem(KEY, JSON.stringify(settings));
}
