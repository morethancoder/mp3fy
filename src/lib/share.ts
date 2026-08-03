/**
 * Share a produced file. On platforms whose webview exposes the Web Share
 * API with file support (Android, recent WebKit) this opens the native
 * share sheet; everywhere else we fall back to revealing the file in the
 * system file manager — the closest desktop equivalent.
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import { revealItemInDir } from '@tauri-apps/plugin-opener';

const MIME: Record<string, string> = {
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4',
	opus: 'audio/ogg',
	flac: 'audio/flac',
	wav: 'audio/wav',
	mp4: 'video/mp4',
	webm: 'video/webm',
	mkv: 'video/x-matroska'
};

export async function shareFile(path: string): Promise<'shared' | 'revealed'> {
	const name = path.split(/[/\\]/).pop() ?? 'file';
	const ext = name.split('.').pop()?.toLowerCase() ?? '';
	try {
		if (navigator.share) {
			const blob = await (await fetch(convertFileSrc(path))).blob();
			const file = new File([blob], name, {
				type: MIME[ext] ?? 'application/octet-stream'
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
	await revealItemInDir(path);
	return 'revealed';
}
