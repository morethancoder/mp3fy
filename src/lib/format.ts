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

/** The file name without its extension — good enough for a track title. */
export function titleFromPath(path: string): string {
	const base = path.split(/[/\\]/).pop() ?? path;
	return base.replace(/\.[^.]+$/, '');
}
