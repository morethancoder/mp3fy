import { locale } from './i18n.svelte';

export function formatBytes(bytes: number | null | undefined): string {
	if (bytes == null || bytes <= 0) return '';
	const units = ['B', 'KB', 'MB', 'GB'];
	let value = bytes;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i++;
	}
	return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
	const s = Math.floor(seconds % 60);
	const m = Math.floor((seconds / 60) % 60);
	const h = Math.floor(seconds / 3600);
	const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
	return `${h > 0 ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
}

export function formatDate(iso: string): string {
	try {
		return new Intl.DateTimeFormat(locale() === 'ar' ? 'ar' : 'en', {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(iso));
	} catch {
		return iso;
	}
}

/**
 * The media type a file name implies. Used both to label a share and to
 * re-type the bytes the player reads: the asset protocol sniffs a type of its
 * own (`audio/m4a` for an m4a, which is not a registered type at all), and a
 * media element that is handed something it does not recognise refuses the
 * file outright.
 */
const MIME: Record<string, string> = {
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4',
	aac: 'audio/aac',
	opus: 'audio/ogg',
	ogg: 'audio/ogg',
	flac: 'audio/flac',
	wav: 'audio/wav',
	mp4: 'video/mp4',
	webm: 'video/webm',
	mkv: 'video/x-matroska'
};

export function mimeFor(path: string): string | null {
	const ext = path.split(/[/\\]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
	return MIME[ext] ?? null;
}

/** The file name without its extension — good enough for a track title. */
export function titleFromPath(path: string): string {
	const base = path.split(/[/\\]/).pop() ?? path;
	return base.replace(/\.[^.]+$/, '');
}
