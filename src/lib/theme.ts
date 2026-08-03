/**
 * Theme preference: light, dark, or system (the default — follows the OS,
 * and keeps following it while the app is open). Written straight to
 * localStorage; the boot script in app.html reads the same key before first
 * paint so the page never flashes the wrong theme.
 */

import { browser } from '$app/environment';

const KEY = 'mp3fy-theme';

export type ThemePreference = 'light' | 'dark' | 'system';

export function loadTheme(): ThemePreference {
	if (!browser) return 'system';
	const raw = localStorage.getItem(KEY);
	return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

export function saveTheme(preference: ThemePreference): void {
	if (!browser) return;
	try {
		localStorage.setItem(KEY, preference);
	} catch {
		// private browsing — the choice just won't survive a reload
	}
	applyTheme(preference);
}

export function systemTheme(): 'light' | 'dark' {
	if (!browser || !window.matchMedia) return 'light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
	return preference === 'system' ? systemTheme() : preference;
}

export function applyTheme(preference: ThemePreference): void {
	if (!browser) return;
	document.documentElement.dataset.theme = resolveTheme(preference);
}

/** Returns a teardown for the caller's `onMount`. */
export function watchSystemTheme(onChange: () => void): () => void {
	if (!browser || !window.matchMedia) return () => {};
	const query = window.matchMedia('(prefers-color-scheme: dark)');
	query.addEventListener('change', onChange);
	return () => query.removeEventListener('change', onChange);
}
