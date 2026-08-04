/**
 * Handing a produced file to the rest of the system — sharing it, or opening
 * it where the platform can.
 *
 * The two halves differ per platform in opposite directions. Sharing works
 * best through the Web Share API where the webview has it (Android, recent
 * WebKit) and falls back to the file manager. Opening has no single answer at
 * all: desktop reveals the file in its file manager, while Android has no file
 * manager to reveal into — the opener plugin documents `reveal_item_in_dir` as
 * unsupported there and simply fails, which the UI used to report as "file no
 * longer exists on disk" over a file that was sitting right there. Android
 * gets an intent instead, from our own plugin.
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { fileExists, isAndroid, openFile } from './api';
import { mimeFor } from './format';
import { m } from './i18n.svelte';

export async function shareFile(path: string): Promise<'shared' | 'revealed'> {
	const name = path.split(/[/\\]/).pop() ?? 'file';
	try {
		if (navigator.share) {
			const blob = await (await fetch(convertFileSrc(path))).blob();
			const file = new File([blob], name, {
				type: mimeFor(path) ?? 'application/octet-stream'
			});
			if (!navigator.canShare || navigator.canShare({ files: [file] })) {
				await navigator.share({ files: [file], title: name });
				return 'shared';
			}
		}
	} catch (e) {
		// AbortError means the user closed the sheet — that's not a fallback case
		if (e instanceof DOMException && e.name === 'AbortError') return 'shared';
	}
	await revealFile(path);
	return 'revealed';
}

/** Put the file in front of the user; rejects if the platform could not. */
export function revealFile(path: string): Promise<void> {
	return isAndroid ? openFile(path) : revealItemInDir(path);
}

/**
 * The same, with the right thing to say when it fails. "The file is gone" and
 * "nothing here can open it" are different problems and only one of them is
 * the user's to fix, so the file is checked before either is claimed.
 */
export async function showFile(path: string): Promise<void> {
	try {
		await revealFile(path);
	} catch {
		const gone = !(await fileExists(path).catch(() => true));
		window.mtui?.toast(gone ? m().library.missing : m().library.openFailed, {
			kind: 'error'
		});
	}
}

/** What "open" means here — a file manager on desktop, an app on Android. */
export function openLabel(): string {
	return isAndroid ? m().done.openWith : m().done.openInFiles;
}
