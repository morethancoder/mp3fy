// Typed wrappers around the Tauri commands in src-tauri/src/.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface VideoInfo {
	title: string;
	uploader: string | null;
	duration: number | null;
	thumbnail: string | null;
}

export interface ToolsStatus {
	ytdlp_version: string | null;
	ffmpeg_available: boolean;
}

export type Stage = 'preparing' | 'fetching' | 'downloading' | 'converting';

export interface ProgressEvent {
	stage: Stage;
	percent: number | null;
	size: string | null;
	speed: string | null;
	eta: string | null;
}

export interface Finished {
	path: string;
	size: number | null;
}

export interface LogEntry {
	ts: number; // unix millis
	source: string;
	message: string;
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** Newest first. */
export function getLogs(): Promise<LogEntry[]> {
	return invoke('get_logs');
}

export function logEvent(source: string, message: string): void {
	if (isTauri) void invoke('log_event', { source, message }).catch(() => {});
}

export function ensureTools(): Promise<ToolsStatus> {
	return invoke('ensure_tools');
}

export function updateYtdlp(): Promise<string> {
	return invoke('update_ytdlp');
}

export function fetchInfo(url: string): Promise<VideoInfo> {
	return invoke('fetch_info', { url });
}

export function downloadsFolder(): Promise<string> {
	return invoke('downloads_folder');
}

export function startDownload(opts: {
	url: string;
	format: string;
	quality: string;
	kind: 'audio' | 'video';
}): Promise<void> {
	return invoke('start_download', { ...opts });
}

export function cancelDownload(): Promise<void> {
	return invoke('cancel_download');
}

export function convertFile(opts: {
	input: string;
	format: string;
	quality: string;
}): Promise<void> {
	return invoke('convert_file', { ...opts });
}

export function cancelConvert(): Promise<void> {
	return invoke('cancel_convert');
}

/** Subscribe to a job's three event channels; returns one teardown. */
export function onJobEvents(
	prefix: 'download' | 'convert',
	handlers: {
		progress: (e: ProgressEvent) => void;
		done: (f: Finished) => void;
		error: (message: string) => void;
	}
): () => void {
	const subs: Promise<UnlistenFn>[] = [
		listen<ProgressEvent>(`${prefix}:progress`, (e) => handlers.progress(e.payload)),
		listen<Finished>(`${prefix}:done`, (e) => handlers.done(e.payload)),
		listen<string>(`${prefix}:error`, (e) => handlers.error(e.payload))
	];
	return () => subs.forEach((p) => p.then((un) => un()));
}
