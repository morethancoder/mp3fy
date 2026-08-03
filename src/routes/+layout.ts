import { browser } from '$app/environment';
import { initI18n } from '$lib/i18n.svelte';

export const ssr = false;
export const prerender = false;
export const csr = true;

// Before any component renders, so enhanced elements (x-select) never paint
// their faces with the wrong language's strings.
export function load() {
	if (browser) initI18n();
}
