<script lang="ts">
	import 'morethanui/js/accordion.js';
	import 'morethanui/js/x-contextmenu.js';
	import { goto } from '$app/navigation';
	import { readText } from '@tauri-apps/plugin-clipboard-manager';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { isTauri } from '$lib/api';
	import { download, startJob, cancelJob, clearJob } from '$lib/downloads.svelte';
	import {
		settings,
		saveSettings,
		AUDIO_FORMATS,
		VIDEO_FORMATS,
		QUALITIES,
		QUALITY_LABEL_KEYS,
		formatKind
	} from '$lib/settings.svelte';
	import { m } from '$lib/i18n.svelte';
	import { play } from '$lib/player.svelte';
	import { shareFile } from '$lib/share';
	import { formatBytes } from '$lib/format';

	let resultMenu = $state<HTMLElement | null>(null);

	const kind = $derived(formatKind(settings.format));

	const stageText = $derived.by(() => {
		const progress = download.progress;
		if (!progress) return '';
		switch (progress.stage) {
			case 'preparing':
				return m().steps.preparing;
			case 'fetching':
				return m().steps.fetching;
			case 'downloading': {
				const parts = [m().steps.downloading];
				if (progress.size) parts.push(m().steps.of(progress.size));
				if (progress.speed) parts.push(`· ${progress.speed}`);
				return parts.join(' ');
			}
			case 'converting':
				return m().steps.converting(download.format);
		}
	});

	async function paste() {
		let text = '';
		try {
			text = (isTauri ? await readText() : await navigator.clipboard.readText()) ?? '';
		} catch {
			window.mtui?.toast(m().home.pasteFailed, { kind: 'error' });
			return;
		}
		if (!/^https?:\/\/\S+\.\S+/.test(text.trim())) {
			window.mtui?.toast(m().home.notALink, { kind: 'error' });
			return;
		}
		download.url = text.trim();
	}

	/** One button, two lives: Paste when empty, Get once a link is in. */
	function primaryAction() {
		if (!download.url.trim()) return paste();
		return startJob();
	}

	/** In a one-field form, Enter means "go" — not "reload the page". */
	function onLinkKey(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		if (download.url.trim()) void startJob();
	}

	function playIt() {
		if (!download.finished) return;
		play(download.finished);
		goto('/library');
	}

	async function reveal() {
		if (!download.finished) return;
		await revealItemInDir(download.finished.path).catch(() =>
			window.mtui?.toast(m().library.missing, { kind: 'error' })
		);
	}

	async function share() {
		if (!download.finished) return;
		if ((await shareFile(download.finished.path)) === 'revealed') {
			window.mtui?.toast(m().done.shareFallback);
		}
	}

	function act(action: string) {
		switch (action) {
			case 'play':
				playIt();
				break;
			case 'reveal':
				void reveal();
				break;
			case 'share':
				void share();
				break;
			case 'dismiss':
				download.finished = null;
				break;
		}
	}

	// The result card's ⋮ is an x-contextmenu trigger, same wiring as History.
	$effect(() => {
		const el = resultMenu;
		if (!el) return;
		const onSelect = (e: Event) =>
			act((e as CustomEvent<{ value: string }>).detail.value);
		el.addEventListener('select', onSelect);
		return () => el.removeEventListener('select', onSelect);
	});
</script>

<div class="screen-stack">
	<h1 class="t-page">{m().home.title}</h1>
	<p class="t-secondary">{m().home.subtitle}</p>

	<div class="card">
		<div class="stack" data-gap="16">
			{#if !download.busy}
				<!-- The link is editable, not just pasteable: a URL typed by
				     hand, or one that needs a stray tracking suffix trimmed
				     off, has to be possible without the clipboard. -->
				<label class="field">
					<span class="t-label">{m().home.videoLink}</span>
					<input
						type="url"
						inputmode="url"
						dir="ltr"
						class="t-ltr"
						autocomplete="off"
						autocapitalize="off"
						autocorrect="off"
						spellcheck="false"
						placeholder={m().home.linkPlaceholder}
						bind:value={download.url}
						onkeydown={onLinkKey}
					/>
				</label>

				<div class="grid">
					<div data-span="4" data-span-md="4" data-span-lg="6">
						<div class="stack" data-gap="8">
							<button
								class="btn"
								data-variant="primary"
								onclick={primaryAction}
								data-feedback="tick"
							>
								{#if !download.url.trim()}
									{m().home.paste}
								{:else}
									{kind === 'video' ? m().home.getVideo : m().home.getAudio}
								{/if}
							</button>
							{#if download.url}
								<button class="btn" data-feedback="tick" onclick={clearJob}>
									<span class="icon" data-icon="x"></span>
									{m().home.clear}
								</button>
							{/if}
						</div>
					</div>
					<div data-span="4" data-span-md="4" data-span-lg="6">
						<details class="accordion">
							<summary>
								<span class="icon" data-icon="settings"></span>
								{m().home.options}
							</summary>
					<div class="accordion-body">
						<div class="stack" data-gap="16">
							<x-select>
								<label class="field">
									<span class="t-label">{m().home.format}</span>
									<span class="select">
										<select bind:value={settings.format} onchange={saveSettings}>
											<optgroup label={m().home.audioFormats}>
												{#each AUDIO_FORMATS as f (f)}
													<option value={f}>{f}</option>
												{/each}
											</optgroup>
											<optgroup label={m().home.videoFormats}>
												{#each VIDEO_FORMATS as f (f)}
													<option value={f}>{f}</option>
												{/each}
											</optgroup>
										</select>
									</span>
								</label>
							</x-select>
							{#if kind === 'audio'}
								<x-select>
									<label class="field">
										<span class="t-label">{m().home.quality}</span>
										<span class="select">
											<select bind:value={settings.quality} onchange={saveSettings}>
												{#each QUALITIES as q (q)}
													<option value={q}>{m().quality[QUALITY_LABEL_KEYS[q]]}</option>
												{/each}
											</select>
										</span>
									</label>
								</x-select>
							{/if}
						</div>
					</div>
						</details>
					</div>
				</div>
			{:else}
				<div class="stack" data-gap="8">
					<div class="row" data-align="between" data-gap="8">
						<span class="t-secondary">{stageText}</span>
						{#if download.progress?.eta}
							<span class="t-label t-ltr">{m().steps.eta(download.progress.eta)}</span>
						{/if}
					</div>
					<div class="progress-track">
						<div
							class="progress-fill"
							style:width="{download.progress?.percent ?? 3}%"
							class:indeterminate={download.progress?.percent == null}
						></div>
					</div>
					<div class="row" data-align="between" data-gap="8">
						<span class="t-label t-ltr">
							{#if download.progress?.percent != null}
								{Math.round(download.progress.percent)}%
							{/if}
						</span>
						<!-- Links shared while this one runs queue up behind it;
						     saying so is what makes Cancel (which drops them)
						     honest. -->
						{#if download.queued.length > 0}
							<span class="badge">{m().home.queuedCount(download.queued.length)}</span>
						{/if}
						<button class="btn" data-variant="ghost" data-feedback="tick" onclick={cancelJob}>
							{m().home.cancel}
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>

	{#if download.error}
		<div class="alert" data-status="danger" data-feedback>
			<span class="icon" data-icon="alert-triangle"></span>
			<div>
				<span class="alert-title">{m().home.failed}</span>
				<p class="t-ltr">{download.error}</p>
			</div>
		</div>
	{/if}

	{#if download.finished}
		{@const file = download.finished}
		<!-- The result reads as a record sleeve: cover, title, artist, one
		     play button — everything else folds into the ⋮ menu. -->
		<x-contextmenu bind:this={resultMenu}>
			<div class="card album">
				<div class="row" data-gap="16" data-align="start">
					<span class="album-cover">
						{#if file.thumbnail}
							<img src={file.thumbnail} alt="" />
						{:else}
							<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
						{/if}
					</span>
					<div class="stack" data-gap="4" style="min-inline-size: 0">
						<span class="t-label">{m().home.saved}</span>
						<span class="album-title">{file.title}</span>
						<!-- An Arabic artist name would drag the size into the
						     wrong reading order without its own LTR island. -->
						<span class="t-secondary album-sub">
							{file.artist ??
								file.format.toUpperCase()}{#if file.size}{' · '}<span class="t-ltr"
									>{formatBytes(file.size)}</span
								>{/if}
						</span>
					</div>
				</div>

				<div class="row" data-gap="8" data-align="between">
					{#if file.kind === 'audio'}
						<button class="btn" data-variant="primary" data-feedback="tick" onclick={playIt}>
							<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
							{m().done.play}
						</button>
					{:else}
						<button class="btn" data-variant="primary" data-feedback="tick" onclick={reveal}>
							{m().done.openInFiles}
						</button>
					{/if}
					<span
						class="btn"
						data-size="icon"
						data-variant="ghost"
						data-contextmenu-trigger
						role="button"
						tabindex="0"
						aria-haspopup="menu"
						aria-label={m().done.more}
					>
						<span class="icon" data-icon="more-vertical"></span>
					</span>
				</div>
			</div>
			<template>
				{#if file.kind === 'audio'}
					<button class="menu-item" data-value="reveal">{m().done.openInFiles}</button>
				{:else}
					<button class="menu-item" data-value="play">{m().done.play}</button>
				{/if}
				<button class="menu-item" data-value="share">{m().done.share}</button>
				<button class="menu-item" data-value="dismiss">{m().done.dismiss}</button>
			</template>
		</x-contextmenu>
	{/if}
</div>

<style>
	/* Minimal progress bar from MTUI tokens only — no invented colors. */
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

	.album {
		display: flex;
		flex-direction: column;
		gap: var(--sp-16);
	}
	.album-cover {
		flex: none;
		display: grid;
		place-items: center;
		inline-size: 5rem;
		block-size: 5rem;
		border-radius: var(--r-card);
		background: var(--accent-tint);
		color: var(--accent-text);
		overflow: hidden;
	}
	.album-cover img {
		inline-size: 100%;
		block-size: 100%;
		object-fit: cover;
	}
	.album-title {
		font-size: var(--fs-card);
		line-height: var(--lh-card);
		font-weight: var(--fw-card);
		/* Titles run long and bilingual — two lines, then ellipsis. */
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.album-sub {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
