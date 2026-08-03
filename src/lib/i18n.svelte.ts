/**
 * Which language the app speaks. Three choices, defaulting to `system`: the
 * device's language decides, and today that resolves to Arabic for an Arabic
 * device and English for everything else. The resolved locale lives in a
 * rune so changing it in Settings re-renders every string in place.
 *
 * Direction rides along with language: Arabic flips the document to RTL.
 * MTUI is written in logical properties throughout, so the layout survives
 * the flip; the few things that must stay left-to-right (file paths,
 * versions, timestamps) wear `t-ltr`.
 */

import { browser } from '$app/environment';
import { en, type Messages } from './i18n/en';
import { ar } from './i18n/ar';

export type AppLanguage = 'en' | 'ar' | 'system';
export type Locale = 'en' | 'ar';

/** Kept in step with the boot script in app.html — same key, same values. */
const KEY = 'mp3fy-app-language';

const DICTS: Record<Locale, Messages> = { en, ar };

function storedPref(): AppLanguage {
	if (!browser) return 'system';
	const raw = localStorage.getItem(KEY);
	return raw === 'en' || raw === 'ar' || raw === 'system' ? raw : 'system';
}

// Resolved synchronously at import time — before any component renders —
// so enhanced elements (x-select) never paint faces in the wrong language.
const initialPref = storedPref();
const current = $state<{ pref: AppLanguage; locale: Locale }>({
	pref: initialPref,
	locale: browser
		? initialPref === 'system'
			? navigator.language?.toLowerCase().startsWith('ar')
				? 'ar'
				: 'en'
			: initialPref
		: 'en'
});

export function systemLocale(): Locale {
	if (!browser) return 'en';
	return navigator.language?.toLowerCase().startsWith('ar') ? 'ar' : 'en';
}

function resolve(pref: AppLanguage): Locale {
	return pref === 'system' ? systemLocale() : pref;
}

function apply(): void {
	if (!browser) return;
	document.documentElement.lang = current.locale;
	document.documentElement.dir = current.locale === 'ar' ? 'rtl' : 'ltr';
}

/** Re-read the saved choice and mirror it onto the document. */
export function initI18n(): void {
	if (!browser) return;
	current.pref = storedPref();
	current.locale = resolve(current.pref);
	apply();
}

export function appLanguage(): AppLanguage {
	return current.pref;
}

export function setAppLanguage(pref: AppLanguage): void {
	current.pref = pref;
	current.locale = resolve(pref);
	apply();
	if (!browser) return;
	try {
		localStorage.setItem(KEY, pref);
	} catch {
		// private browsing — the choice just won't survive a reload
	}
}

/** The resolved locale — for `Intl` formatters that want a tag, not a dict. */
export function locale(): Locale {
	return current.locale;
}

/** The current dictionary; reading it in a template tracks the locale rune. */
export function m(): Messages {
	return DICTS[current.locale];
}
