<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import {
		isTauri,
		convertFile,
		cancelConvert,
		onJobEvents,
		type ProgressEvent
	} from '$lib/api';
	import {
		AUDIO_FORMATS,
		QUALITIES,
		QUALITY_LABEL_KEYS,
		type MediaFormat
	} from '$lib/settings.svelte';
	import { m } from '$lib/i18n.svelte';
	import { addToHistory, type HistoryEntry } from '$lib/history.svelte';
	import { play } from '$lib/player.svelte';
	import { shareFile } from '$lib/share';
	import { chime } from '$lib/feedback';
	import { formatBytes, titleFromPath } from '$lib/format';

	let input = $state<string | null>(null);
	let format = $state<MediaFormat>('mp3');
	let quality = $state<(typeof QUALITIES)[number]>('best');
	let busy = $state(false);
	let progress = $state<ProgressEvent | null>(null);
	let finished = $state<HistoryEntry | null>(null);
	let error = $state<string | null>(null);

	const lossless = $derived(format === 'flac' || format === 'wav');

	onMount(() => {
		if (!isTauri) return;
		return onJobEvents('convert', {
			progress: (e) => (progress = e),
			done: (f) => {
				busy = false;
				progress = null;
				if (f.path) {
					finished = addToHistory({ path: f.path, format, kind: 'audio', size: f.size });
				}
				// No `kind`: that would fire MTUI's success cue over our own,
				// longer completion chime.
				window.mtui?.toast(m().home.saved);
				chime();
			},
			error: (message) => {
				busy = false;
				progress = null;
				error = message;
			}
		});
	});

	async function choose() {
		const picked = await openDialog({
			multiple: false,
			directory: false,
			title: m().convert.pickerTitle,
			filters: [
				{
					name: m().convert.pickerTitle,
					extensions: [
						'mp4', 'webm', 'mkv', 'mov', 'avi', 'flv', 'ts', 'm4v', '3gp',
						'mp3', 'm4a', 'opus', 'ogg', 'flac', 'wav', 'aac', 'wma'
					]
				}
			]
		});
		if (typeof picked === 'string') input = picked;
	}

	async function convert() {
		if (!input) return;
		error = null;
		finished = null;
		busy = true;
		progress = { stage: 'preparing', percent: null, size: null, speed: null, eta: null };
		try {
			await convertFile({ input, format, quality });
		} catch (e) {
			busy = false;
			progress = null;
			error = String(e);
		}
	}

	async function cancel() {
		await cancelConvert();
		busy = false;
		progress = null;
	}

	function playIt() {
		if (!finished) return;
		play(finished);
		goto('/library');
	}

	async function share() {
		if (!finished) return;
		if ((await shareFile(finished.path)) === 'revealed') {
			window.mtui?.toast(m().done.shareFallback);
		}
	}
</script>

<div class="screen-stack">
	<h1 class="t-page">{m().convert.title}</h1>
	<p class="t-secondary">{m().convert.subtitle}</p>

	<div class="card">
		<div class="stack" data-gap="16">
			{#if input}
				<div class="row" data-align="between" data-gap="12">
					<span class="item-text">
						<span class="item-title">{titleFromPath(input)}</span>
						<span class="item-sub t-ltr">{input}</span>
					</span>
					<button class="btn" onclick={choose} disabled={busy}>
						{m().convert.changeFile}
					</button>
				</div>
			{:else}
				<button class="btn" data-variant="primary" onclick={choose} disabled={!isTauri}>
					<span class="icon" data-icon="plus"></span>
					{m().convert.chooseFile}
				</button>
			{/if}

			{#if input}
				<div class="grid">
					<div data-span="2" data-span-md="4" data-span-lg="6">
						<x-select>
							<label class="field">
								<span class="t-label">{m().convert.targetFormat}</span>
								<span class="select">
									<select bind:value={format} disabled={busy}>
										{#each AUDIO_FORMATS as f (f)}
											<option value={f}>{f}</option>
										{/each}
									</select>
								</span>
							</label>
						</x-select>
					</div>
					{#if !lossless}
						<div data-span="2" data-span-md="4" data-span-lg="6">
							<x-select>
								<label class="field">
									<span class="t-label">{m().home.quality}</span>
									<span class="select">
										<select bind:value={quality} disabled={busy}>
											{#each QUALITIES as q (q)}
												<option value={q}>{m().quality[QUALITY_LABEL_KEYS[q]]}</option>
											{/each}
										</select>
									</span>
								</label>
							</x-select>
						</div>
					{/if}
				</div>

				{#if !busy}
					<button class="btn" data-variant="primary" onclick={convert} data-feedback="tick">
						{m().convert.convert}
					</button>
				{:else}
					<div class="stack" data-gap="8">
						<div class="row" data-align="between">
							<span class="t-secondary">
								{progress?.stage === 'converting' ? m().convert.converting : m().convert.preparing}
							</span>
							{#if progress?.percent != null}
								<span class="t-label t-ltr">{Math.round(progress.percent)}%</span>
							{/if}
						</div>
						<div class="progress-track">
							<div
								class="progress-fill"
								style:width="{progress?.percent ?? 3}%"
								class:indeterminate={progress?.percent == null}
							></div>
						</div>
						<button class="btn" data-variant="ghost" onclick={cancel}>
							{m().home.cancel}
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>

	{#if error}
		<div class="alert" data-status="danger" data-feedback>
			<span class="icon" data-icon="alert-triangle"></span>
			<div>
				<span class="alert-title">{m().convert.failed}</span>
				<p class="t-ltr">{error}</p>
			</div>
		</div>
	{/if}

	{#if finished}
		<div class="card">
			<div class="stack" data-gap="12">
				<span class="item-text">
					<span class="item-title">{m().home.saved}</span>
					<span class="item-sub t-ltr">
						{finished.title}{finished.size ? ` — ${formatBytes(finished.size)}` : ''}
					</span>
				</span>
				<div class="row" data-gap="8" data-wrap="on">
					<button class="btn" data-variant="primary" onclick={playIt}>
						{m().done.play}
					</button>
					<button class="btn" onclick={() => revealItemInDir(finished!.path)}>
						{m().done.openInFiles}
					</button>
					<button class="btn" onclick={share}>
						<span class="icon" data-icon="share"></span>
						{m().done.share}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.progress-track {
		height: 6px;
		border-radius: var(--r-card);
		background: var(--surface-2);
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width 300ms ease;
	}
	.progress-fill.indeterminate {
		animation: slide 1.2s ease-in-out infinite alternate;
	}
	@keyframes slide {
		from {
			margin-inline-start: 0%;
		}
		to {
			margin-inline-start: 97%;
		}
	}
</style>
