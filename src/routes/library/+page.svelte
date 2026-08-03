<script lang="ts">
	import 'morethanui/js/x-contextmenu.js';
	import { onMount } from 'svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import { m, locale } from '$lib/i18n.svelte';
	import { history, removeFromHistory, type HistoryEntry } from '$lib/history.svelte';
	import {
		playlists,
		createPlaylist,
		deletePlaylist,
		toggleInPlaylist
	} from '$lib/playlists.svelte';
	import { play, player } from '$lib/player.svelte';
	import { shareFile } from '$lib/share';
	import { formatBytes, formatDate } from '$lib/format';

	type Sort = 'recent' | 'plays' | 'title';
	let sort = $state<Sort>('recent');
	let activeList = $state<'all' | string>('all');
	let newName = $state('');
	let target = $state<HistoryEntry | null>(null);
	let list = $state<HTMLElement | null>(null);

	const visible = $derived.by(() => {
		// Everything the app has produced lives here now that History is gone:
		// audio plays in place, video hands off to the file manager.
		let entries = history.entries;
		if (activeList !== 'all') {
			const ids = playlists.lists.find((l) => l.id === activeList)?.ids ?? [];
			entries = entries.filter((e) => ids.includes(e.id));
		}
		const sorted = [...entries];
		if (sort === 'plays') sorted.sort((a, b) => b.plays - a.plays);
		else if (sort === 'title')
			sorted.sort((a, b) => a.title.localeCompare(b.title, locale()));
		else sorted.sort((a, b) => b.date.localeCompare(a.date));
		return sorted;
	});

	function open(entry: HistoryEntry) {
		if (entry.kind === 'audio') play(entry, visible);
		else
			revealItemInDir(entry.path).catch(() =>
				window.mtui?.toast(m().library.missing, { kind: 'error' })
			);
	}

	function dialogEl(): HTMLDialogElement {
		return document.getElementById('playlist-dialog') as HTMLDialogElement;
	}

	function createList() {
		if (!newName.trim()) return;
		const created = createPlaylist(newName);
		if (target) toggleInPlaylist(created.id, target.id);
		newName = '';
	}

	/**
	 * Inside a `form method="dialog"` an Enter in the text field implicitly
	 * submits — which closes the dialog and throws the typed name away.
	 * Enter has to mean Create here.
	 */
	function onNameKey(e: KeyboardEvent) {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		createList();
	}

	function removeList() {
		if (activeList === 'all') return;
		deletePlaylist(activeList);
		activeList = 'all';
	}

	async function act(action: string, id: string | undefined) {
		const entry = history.entries.find((e) => e.id === id);
		if (!entry) return;
		switch (action) {
			case 'play':
				open(entry);
				break;
			case 'playlist':
				target = entry;
				dialogEl().showModal();
				break;
			case 'reveal':
				await revealItemInDir(entry.path).catch(() =>
					window.mtui?.toast(m().library.missing, { kind: 'error' })
				);
				break;
			case 'share':
				if ((await shareFile(entry.path)) === 'revealed') {
					window.mtui?.toast(m().done.shareFallback);
				}
				break;
			case 'remove':
				removeFromHistory(entry.id);
				window.mtui?.toast(m().library.removed);
				break;
		}
	}

	onMount(() => {
		const el = list;
		if (!el) return;
		const onSelect = (e: Event) => {
			const detail = (e as CustomEvent<{ value: string; target: HTMLElement }>).detail;
			const row = detail.target.closest('.item') as HTMLElement | null;
			void act(detail.value, row?.dataset.id);
		};
		el.addEventListener('select', onSelect);
		return () => el.removeEventListener('select', onSelect);
	});
</script>

<div class="screen-stack">
	<h1 class="t-page">{m().library.title}</h1>

	{#if history.entries.length === 0}
		<div class="empty">
			<span class="empty-icon">
				<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
			</span>
			<span class="t-card">{m().library.emptyTitle}</span>
			<p class="t-secondary">{m().library.emptyBody}</p>
			<a class="btn" data-variant="primary" href="/">{m().nav.home}</a>
		</div>
	{:else}
		<div class="row" data-gap="8" data-wrap="on">
			<button
				class="chip"
				aria-pressed={activeList === 'all'}
				onclick={() => (activeList = 'all')}
			>
				{m().library.all}
			</button>
			{#each playlists.lists as playlist (playlist.id)}
				<button
					class="chip"
					aria-pressed={activeList === playlist.id}
					onclick={() => (activeList = playlist.id)}
				>
					{playlist.name}
				</button>
			{/each}
			{#if activeList !== 'all'}
				<button
					class="btn"
					data-size="icon"
					data-variant="ghost"
					aria-label={m().library.deletePlaylist}
					onclick={removeList}
				>
					<span class="icon" data-icon="trash"></span>
				</button>
			{/if}
		</div>

		<fieldset class="segmented">
			<label>
				<input type="radio" name="sort" checked={sort === 'recent'} onchange={() => (sort = 'recent')} />
				<span>{m().library.sortRecent}</span>
			</label>
			<label>
				<input type="radio" name="sort" checked={sort === 'plays'} onchange={() => (sort = 'plays')} />
				<span>{m().library.sortPlays}</span>
			</label>
			<label>
				<input type="radio" name="sort" checked={sort === 'title'} onchange={() => (sort = 'title')} />
				<span>{m().library.sortTitle}</span>
			</label>
		</fieldset>

		<x-contextmenu bind:this={list}>
			<div class="stack" data-gap="8">
				{#each visible as entry (entry.id)}
					<div class="card" style="padding: 0">
						<button
							class="item"
							style="inline-size: 100%"
							data-id={entry.id}
							class:playing={player.current?.id === entry.id}
							onclick={() => open(entry)}
						>
							<!-- The cover doubles as the play affordance on pointer
							     devices; touch just taps the row. -->
							<span class="cover avatar" data-tint={entry.kind === 'video' ? 'sky' : 'lavender'}>
								{#if entry.thumbnail}
									<img src={entry.thumbnail} alt="" draggable="false" />
								{:else if entry.kind === 'video'}
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m10 9 5 3-5 3z"/></svg>
								{:else}
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
								{/if}
								<span class="cover-play" aria-hidden="true">
									<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
								</span>
							</span>
							<span class="item-text">
								<span class="item-title">{entry.title}</span>
								<span class="item-sub">
									{#if entry.artist}{entry.artist} · {/if}
									{#if entry.kind === 'audio'}
										{m().library.playsCount(entry.plays)}
									{:else}
										<span class="badge">{entry.format}</span>
									{/if}
									{#if entry.size}
										· <span class="t-ltr">{formatBytes(entry.size)}</span>
									{/if}
									· {formatDate(entry.date)}
								</span>
							</span>
							<span
								class="btn"
								data-size="icon"
								data-variant="ghost"
								data-contextmenu-trigger
								role="button"
								tabindex="0"
								aria-haspopup="menu"
								aria-label={m().library.actions}
							>
								<span class="icon" data-icon="more-vertical"></span>
							</span>
						</button>
					</div>
				{/each}
			</div>
			<template>
				<button class="menu-item" data-value="play">{m().library.play}</button>
				<button class="menu-item" data-value="playlist">{m().library.addToPlaylist}</button>
				<button class="menu-item" data-value="reveal">{m().library.reveal}</button>
				<button class="menu-item" data-value="share">{m().library.share}</button>
				<button class="menu-item" data-value="remove" data-danger>{m().library.remove}</button>
			</template>
		</x-contextmenu>
	{/if}
</div>

<dialog class="dialog" id="playlist-dialog">
	<!-- Every control here commits the moment you touch it, so the footer
	     closes rather than confirms: "Done", and never the primary button —
	     the accent belongs to the action that creates something. -->
	<form method="dialog" class="stack" data-gap="20">
		<div class="stack" data-gap="4">
			<span class="t-card">{m().library.addToPlaylist}</span>
			{#if target}
				<p class="t-secondary dialog-track">{target.title}</p>
			{/if}
		</div>

		{#if playlists.lists.length > 0}
			<div class="stack" data-gap="8">
				{#each playlists.lists as playlist (playlist.id)}
					<label class="row dialog-check" data-gap="12">
						<input
							type="checkbox"
							class="checkbox"
							data-feedback
							checked={!!target && playlist.ids.includes(target.id)}
							onchange={() => target && toggleInPlaylist(playlist.id, target.id)}
						/>
						<span class="t-row">{playlist.name}</span>
					</label>
				{/each}
			</div>
		{/if}

		<div class="field">
			<span class="t-label" id="playlist-name-label">{m().library.playlistName}</span>
			<div class="row" data-gap="8">
				<input
					type="text"
					bind:value={newName}
					style="flex: 1; min-inline-size: 0"
					aria-labelledby="playlist-name-label"
					onkeydown={onNameKey}
				/>
				<button
					type="button"
					class="btn"
					data-variant="primary"
					onclick={createList}
					disabled={!newName.trim()}
				>
					{m().library.create}
				</button>
			</div>
		</div>

		<button class="btn" value="close">{m().library.done}</button>
	</form>
</dialog>

<style>
	.item.playing .item-title {
		color: var(--accent-text);
	}
	.cover {
		position: relative;
		overflow: hidden;
	}
	.cover img {
		inline-size: 100%;
		block-size: 100%;
		object-fit: cover;
	}
	/* Hover only — a touch device has no hover, and tapping the row is the
	   same action anyway. */
	.cover-play {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		background: var(--scrim);
		color: #fff;
		opacity: 0;
		transition: opacity var(--t-micro) var(--ease);
	}
	.item:hover .cover-play,
	.item:focus-visible .cover-play {
		opacity: 1;
	}
	@media (hover: none) {
		.cover-play {
			display: none;
		}
	}
	/* Bilingual titles run long; the dialog must not grow to fit one. */
	.dialog-track {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.dialog-check {
		align-items: center;
		cursor: pointer;
	}
	/* Enough playlists and the dialog would grow past the screen. */
	#playlist-dialog {
		max-block-size: calc(100dvh - var(--sp-48));
		overflow: auto;
	}
</style>
