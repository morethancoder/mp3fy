<script lang="ts">
	import 'morethanui/css/tokens.css';
	import 'morethanui/css/base.css';
	import 'morethanui/css/layout.css';
	import 'morethanui/css/components.css';
	import '../app.css';
	import 'morethanui/js/x-select.js';
	import 'morethanui/js/x-toast.js';
	import 'morethanui/js/feedback.js';
	// Anchors the player's options + volume popovers under their triggers.
	import 'morethanui/js/menu.js';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { isTauri, ensureTools, updateYtdlp, logEvent } from '$lib/api';
	import { settings } from '$lib/settings.svelte';
	import { m } from '$lib/i18n.svelte';
	import { applyTheme, loadTheme, watchSystemTheme } from '$lib/theme';
	import {
		player,
		toggle,
		seek,
		skip,
		next,
		previous,
		collapse,
		expand,
		stop,
		toggleShuffle,
		setRepeat,
		setVolume,
		REPEAT_MODES,
		type RepeatMode
	} from '$lib/player.svelte';
	import { download, initDownloads, keepExisting, redownload } from '$lib/downloads.svelte';
	import { initSharedLinks } from '$lib/shared-links';
	import { initSafeArea } from '$lib/safe-area';
	import { formatTime } from '$lib/format';

	let { children } = $props();

	const seekPct = $derived(
		player.duration > 0 ? (player.currentTime / player.duration) * 100 : 0
	);

	function onSeek(e: Event) {
		seek(Number((e.currentTarget as HTMLInputElement).value));
	}

	function repeatLabel(mode: RepeatMode): string {
		const labels = m().player;
		return mode === 'one'
			? labels.repeatOne
			: mode === 'all'
				? labels.repeatAll
				: mode === 'stop'
					? labels.repeatStop
					: labels.repeatOff;
	}

	function onVolume(e: Event) {
		setVolume(Number((e.currentTarget as HTMLInputElement).value) / 100);
	}

	const volumePct = $derived(Math.round(player.volume * 100));

	/* ---- Swipe: sideways for the track, down to put the player away ----
	   Both axes used to change track, which left no gesture for "close" and
	   made the wrong one dangerous: the flick you make to dismiss a
	   full-screen player on any phone threw you onto the previous track
	   instead. Sideways is the record shelf, down is the way out — the same
	   pair every music player on a phone uses.

	   The axis is decided once, at the start of the drag, and the rest of the
	   gesture belongs to it: a swipe left that sags a little must not turn
	   into a dismissal halfway through. The wheel branch gives a trackpad the
	   sideways half; one cooldown keeps a single flick from skipping three
	   tracks. */

	const SWIPE = 64; // px of travel before the gesture counts
	const AXIS_LOCK = 12; // px before the drag decides which way it is going
	let dragFrom: { x: number; y: number } | null = null;
	let dragX = $state(0);
	let dragY = $state(0);
	let axis: 'x' | 'y' | null = null;
	let wheelAt = 0;
	let wheelSum = 0;

	const dragging = $derived(dragX !== 0 || dragY !== 0);

	function interactive(target: EventTarget | null): boolean {
		return !!(target as HTMLElement | null)?.closest?.('input, button, a, [role="button"]');
	}

	function onPointerDown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		if (interactive(e.target)) return; // the seek bar owns its own drag
		dragFrom = { x: e.clientX, y: e.clientY };
		axis = null;
		// Capture, or the cover art starts a native image drag one move in and
		// the browser swallows the rest of the gesture.
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!dragFrom) return;
		const dx = e.clientX - dragFrom.x;
		const dy = e.clientY - dragFrom.y;
		if (!axis) {
			if (Math.abs(dx) < AXIS_LOCK && Math.abs(dy) < AXIS_LOCK) return;
			axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
		}
		if (axis === 'x') dragX = dx;
		// Upwards there is nothing to reveal — the player is already the whole
		// screen — so only the downward half of the axis follows the finger.
		else dragY = Math.max(0, dy);
	}

	function onPointerUp(e: PointerEvent) {
		if (!dragFrom) return;
		const travelledX = dragX;
		const travelledY = dragY;
		const settled = axis;
		dragFrom = null;
		axis = null;
		dragX = 0;
		dragY = 0;
		const surface = e.currentTarget as HTMLElement;
		if (surface.hasPointerCapture(e.pointerId)) surface.releasePointerCapture(e.pointerId);
		if (settled === 'y') {
			if (travelledY >= SWIPE) collapse();
			return;
		}
		// Physical direction, in both writing directions: the track you are
		// pushing off the screen is the one you are leaving.
		if (travelledX <= -SWIPE) next();
		else if (travelledX >= SWIPE) previous();
	}

	function onWheel(e: WheelEvent) {
		// Horizontal only: a trackpad's two-finger sideways flick is the same
		// gesture as the touch one. A mouse wheel scrolls nothing here.
		const now = e.timeStamp;
		if (now - wheelAt > 400) wheelSum = 0; // new flick, not the same one
		wheelSum += e.deltaX;
		if (Math.abs(wheelSum) < 120) return;
		wheelAt = now;
		if (wheelSum > 0) next();
		else previous();
		wheelSum = 0;
	}

	/** The mini player is a drawer: pull it up and the big player opens. */
	let miniFrom: number | null = null;

	function onMiniDown(e: PointerEvent) {
		if (e.pointerType === 'mouse') return; // desktop clicks the row instead
		miniFrom = e.clientY;
	}

	function onMiniUp(e: PointerEvent) {
		if (miniFrom == null) return;
		const travelled = e.clientY - miniFrom;
		miniFrom = null;
		if (travelled <= -32) expand();
	}

	/**
	 * The duplicate question, asked from the layout for the same reason the
	 * job lives there: a shared link can arrive on any screen, and the answer
	 * decides what a running queue does next.
	 */
	let duplicateDialog = $state<HTMLDialogElement | null>(null);

	$effect(() => {
		const dialog = duplicateDialog;
		if (!dialog) return;
		if (download.duplicate && !dialog.open) dialog.showModal();
		else if (!download.duplicate && dialog.open) dialog.close();
	});

	onMount(() => {
		// The system bars are not visible to CSS on Android; this measures them
		// and hands them to app.css. Before anything paints against an edge.
		const stopSafeArea = initSafeArea();

		// Subscribed once, for the life of the app: a download keeps running
		// and still lands in History while the user browses other tabs.
		initDownloads();

		// Same reasoning, one level up: a link shared from another app can
		// arrive on any screen, so nothing about it belongs to a component.
		void initSharedLinks();

		// Frontend failures land in the same buffer as engine events, so the
		// Logs screen tells the whole story.
		window.addEventListener('error', (e) => logEvent('ui', String(e.message)));
		window.addEventListener('unhandledrejection', (e) =>
			logEvent('ui', String(e.reason))
		);

		if (isTauri) {
			// First run downloads yt-dlp; afterwards optionally self-update quietly.
			ensureTools()
				.then(() => {
					if (settings.autoUpdateYtdlp) return updateYtdlp();
				})
				.catch(() => {});
		}

		// Someone on "System" who changes their OS theme should see this follow.
		const stopThemeWatch = watchSystemTheme(() => applyTheme(loadTheme()));
		return () => {
			stopSafeArea();
			stopThemeWatch();
		};
	});

	function current(path: string, exact = false): 'page' | undefined {
		const here = page.url.pathname;
		return (exact ? here === path : here.startsWith(path)) ? 'page' : undefined;
	}
</script>

<svelte:head>
	<title>{m().appName}</title>
</svelte:head>

<!-- Light/dark is a Settings choice, not a title-bar switch: one place to
     change it, and "System" (the default) can't be expressed by a toggle. -->
<header class="shell-header">
	<span class="t-card">{m().appName}</span>
</header>

<nav class="shell-nav">
	<a href="/" aria-current={current('/', true)}>
		<span class="icon" data-icon="home"></span>
		<span>{m().nav.home}</span>
	</a>
	<a href="/convert" aria-current={current('/convert')}>
		<!-- no convert/repeat icon in the MTUI set -->
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
		<span>{m().nav.convert}</span>
	</a>
	<a href="/library" aria-current={current('/library')}>
		<!-- no library/disc icon in the MTUI set -->
		<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
		<span>{m().nav.library}</span>
	</a>
	<a href="/settings" aria-current={current('/settings')}>
		<span class="icon" data-icon="settings"></span>
		<span>{m().nav.settings}</span>
	</a>
</nav>

<main class="shell-content">
	{@render children()}

	{#if player.current && !player.expanded}
		<div class="mini-dock">
			<!-- Pull-up is an enhancement on top of the real affordance: the
			     row below is a button that expands on click and on Enter. -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="mini"
				onpointerdown={onMiniDown}
				onpointerup={onMiniUp}
				onpointercancel={() => (miniFrom = null)}
			>
				<span class="mini-handle" aria-hidden="true"></span>
				<button class="mini-main" onclick={expand} aria-label={m().player.nowPlaying}>
					{#if player.current.thumbnail}
						<span class="avatar"><img src={player.current.thumbnail} alt="" draggable="false" /></span>
					{:else}
						<span class="avatar" data-tint="lavender">
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
						</span>
					{/if}
					<span class="item-text">
						<span class="item-title">{player.current.title}</span>
						{#if player.current.artist}
							<span class="item-sub">{player.current.artist}</span>
						{/if}
					</span>
				</button>
				<button
					class="btn"
					data-size="icon"
					data-variant="ghost"
					aria-label={player.playing ? m().player.pause : m().player.play}
					onclick={toggle}
				>
					{#if player.playing}
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
					{:else}
						<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
					{/if}
				</button>
				<!-- Putting the drawer down: without this the dock has no way
				     out, since collapsing the big player is what opens it. -->
				<button
					class="btn"
					data-size="icon"
					data-variant="ghost"
					aria-label={m().player.stop}
					title={m().player.stop}
					onclick={stop}
				>
					<span class="icon" data-icon="x"></span>
				</button>
			</div>
		</div>
	{/if}
</main>

<!-- Already downloaded? Ask, rather than quietly fetch it twice or quietly
     refuse to. Esc and the backdrop mean "keep what I have" — the same as the
     escape-hatch button, which never wears the accent: that belongs to the
     action that commits, and here that is downloading again. -->
<dialog
	class="dialog"
	id="duplicate-dialog"
	bind:this={duplicateDialog}
	onclose={keepExisting}
>
	{#if download.duplicate}
		{@const existing = download.duplicate.entry}
		<div class="stack" data-gap="20">
			<div class="stack" data-gap="4">
				<span class="t-card">{m().home.duplicateTitle}</span>
				<p class="t-secondary dupe-title">{m().home.duplicateBody(existing.title)}</p>
			</div>
			<div class="row" data-gap="8" data-align="between">
				<button class="btn" onclick={keepExisting} data-feedback="tick">
					{m().home.duplicateKeep}
				</button>
				<button class="btn" data-variant="primary" onclick={redownload} data-feedback="tick">
					{m().home.duplicateAgain}
				</button>
			</div>
		</div>
	{/if}
</dialog>

{#if player.current && player.expanded}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="bigplayer"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onwheel={onWheel}
	>
		<!-- The cover, blown up and blurred behind everything: the room takes
		     the colour of the record playing in it. -->
		<div
			class="bigplayer-wash"
			class:plain={!player.current.thumbnail}
			style:background-image={player.current.thumbnail
				? `url("${player.current.thumbnail}")`
				: undefined}
		></div>
		<div class="bigplayer-veil"></div>

		<button
			class="btn bigplayer-close"
			data-size="icon"
			data-variant="ghost"
			aria-label={m().player.close}
			onclick={collapse}
		>
			<span class="icon" data-icon="chevron-down"></span>
		</button>

		<!-- Everything that isn't the transport lives in the opposite top
		     corner: one options menu, one volume popover. -->
		<div class="row bigplayer-actions" data-gap="4">
			<button
				class="btn"
				data-size="icon"
				data-variant="ghost"
				popovertarget="player-volume"
				aria-label={m().player.volume}
				title={m().player.volume}
			>
				{#if player.volume === 0}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>
				{:else if player.volume < 0.5}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
				{:else}
					<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>
				{/if}
			</button>
			<button
				class="btn"
				data-size="icon"
				data-variant="ghost"
				popovertarget="player-options"
				aria-label={m().player.options}
				title={m().player.options}
			>
				<span class="icon" data-icon="more-vertical"></span>
			</button>
		</div>

		<!-- Volume stands up: the slider runs bottom-to-top like every mixer
		     fader, which also keeps the popover narrow enough to sit under its
		     trigger instead of spanning the screen. -->
		<div class="menu volume-pop" id="player-volume" popover>
			<div class="stack" data-gap="12" data-align="center">
				<span class="t-label t-ltr">{volumePct}%</span>
				<input
					class="seek vslider"
					type="range"
					min="0"
					max="100"
					step="1"
					value={volumePct}
					oninput={onVolume}
					aria-label={m().player.volume}
					style="background: linear-gradient(to top, var(--accent) {volumePct}%, var(--surface-2) {volumePct}%)"
				/>
				<span class="icon volume-icon" data-icon="volume-2" aria-hidden="true"></span>
			</div>
		</div>

		<div class="menu" id="player-options" popover>
			<button
				class="menu-item"
				onclick={toggleShuffle}
				popovertarget="player-options"
				popovertargetaction="hide"
			>
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="M4 4l5 5"/></svg>
				{m().player.shuffle}
				{#if player.shuffle}
					<span class="menu-check icon" data-icon="check"></span>
				{/if}
			</button>
			<span class="menu-label t-label">{m().player.repeat}</span>
			{#each REPEAT_MODES as mode (mode)}
				<button
					class="menu-item"
					onclick={() => setRepeat(mode)}
					popovertarget="player-options"
					popovertargetaction="hide"
				>
					{#if mode === 'one'}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><path d="M11 10h1v4"/></svg>
					{:else if mode === 'stop'}
						<!-- The repeat loop with a stop square inside it, the way
						     repeat-one carries a 1. -->
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><rect x="10" y="10" width="4" height="4" fill="currentColor" stroke="none"/></svg>
					{:else if mode === 'all'}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>
					{:else}
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/><line x1="3" y1="21" x2="21" y2="3"/></svg>
					{/if}
					{repeatLabel(mode)}
					{#if player.repeat === mode}
						<span class="menu-check icon" data-icon="check"></span>
					{/if}
				</button>
			{/each}
		</div>

		<!-- One column on a phone, cover beside the transport once the window
		     is wide (or short and landscape) — same markup, the grid below
		     decides. -->
		<div
			class="stack bigplayer-body"
			class:dragging
			data-gap="20"
			data-align="center"
			style:translate="{dragX * 0.6}px {dragY * 0.4}px"
		>
			<span class="artwork">
				{#if player.current.thumbnail}
					<img src={player.current.thumbnail} alt="" draggable="false" />
				{:else}
					<svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
				{/if}
			</span>

			<div class="stack bigplayer-controls" data-gap="20" data-align="center">
				<div class="stack now-title" data-gap="4" data-align="center">
					<span class="t-card">{player.current.title}</span>
					<span class="t-secondary">
						{player.current.artist ?? player.current.format}
					</span>
				</div>

				<div class="stack" data-gap="4" style="inline-size: 100%" dir="ltr">
					<input
						class="seek"
						type="range"
						min="0"
						max={player.duration || 0}
						step="0.1"
						value={player.currentTime}
						oninput={onSeek}
						aria-label={m().player.seek}
						style="background: linear-gradient(90deg, var(--accent) {seekPct}%, var(--surface-2) {seekPct}%)"
					/>
					<div class="row" data-align="between">
						<span class="t-label t-ltr">{formatTime(player.currentTime)}</span>
						<span class="t-label t-ltr">{formatTime(player.duration)}</span>
					</div>
				</div>

				<div class="row" data-gap="8" data-align="center">
					<button class="btn" data-size="icon" data-variant="ghost" aria-label={m().player.previous} onclick={previous}>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
					</button>
					<button class="btn" data-size="icon" data-variant="ghost" aria-label={m().player.back10} onclick={() => skip(-10)}>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/></svg>
					</button>
					<button
						class="btn"
						data-variant="primary"
						data-size="icon"
						style="scale: 1.25"
						aria-label={player.playing ? m().player.pause : m().player.play}
						onclick={toggle}
					>
						{#if player.playing}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
						{:else}
							<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"/></svg>
						{/if}
					</button>
					<button class="btn" data-size="icon" data-variant="ghost" aria-label={m().player.forward10} onclick={() => skip(10)}>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 3v5h-5"/><path d="M20.95 13A9 9 0 1 1 18 5.3L21 8"/></svg>
					</button>
					<button class="btn" data-size="icon" data-variant="ghost" aria-label={m().player.next} onclick={next}>
						<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
					</button>
				</div>

				<span class="t-label swipe-hint">{m().player.swipeHint}</span>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Player chrome, built from MTUI tokens — no invented colors. */
	main.shell-content {
		display: flex;
		flex-direction: column;
	}
	/* The mini player is a drawer pulled up from the bottom edge, not a
	   floating card: square bottom corners, a grab handle where a card would
	   have padding, and a hairline against the content scrolling behind it. */
	.mini-dock {
		position: sticky;
		inset-block-end: 0;
		margin-block-start: auto;
		padding-block-start: var(--sp-16);
	}
	.mini {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--sp-8);
		/* Lines up with the 40rem content column instead of stretching across
		   a desktop window — the dock belongs to the screen above it. */
		max-inline-size: 40rem;
		margin-inline: auto;
		padding: var(--sp-8) var(--pad) var(--sp-12);
		background: var(--surface);
		border-block-start: 1px solid var(--border-color);
		border-start-start-radius: var(--r-card);
		border-start-end-radius: var(--r-card);
		border-end-start-radius: 0;
		border-end-end-radius: 0;
		touch-action: pan-y;
		/* Pulling the drawer up must not paint a text selection on the way. */
		user-select: none;
	}
	.mini img {
		-webkit-user-drag: none;
		user-select: none;
	}
	.mini-handle {
		position: absolute;
		inset-block-start: var(--sp-8);
		inset-inline: 0;
		margin-inline: auto;
		inline-size: var(--sp-40);
		block-size: var(--sp-4);
		border-radius: var(--r-ctl);
		background: var(--surface-3);
	}
	.mini > :not(.mini-handle) {
		margin-block-start: var(--sp-8);
	}
	.mini-main {
		display: flex;
		align-items: center;
		gap: var(--sp-12);
		flex: 1;
		min-inline-size: 0;
		background: none;
		border: none;
		padding: 0;
		color: inherit;
		font: inherit;
		text-align: start;
		cursor: pointer;
	}
	/* Bilingual titles run long; the question must not grow to fit one. */
	.dupe-title {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.bigplayer {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: grid;
		place-items: center;
		/* The overlay covers the tab bar and the status bar with it, so it is
		   on its own for the insets the shell would otherwise have handled. */
		padding: calc(var(--pad) + var(--safe-top-css)) calc(var(--pad) + var(--safe-right-css))
			calc(var(--pad) + var(--safe-bottom-css)) calc(var(--pad) + var(--safe-left-css));
		background: var(--bg);
		overflow: hidden;
		/* The screen is the gesture surface in both axes now — sideways for
		   the track, down to dismiss — so the browser must not claim either
		   for panning. The seek bar takes its own back below. */
		touch-action: none;
		user-select: none;
	}
	/* A range input dragged with a finger needs the browser to leave the
	   gesture alone; `none` is what a slider wants anyway. */
	.bigplayer .seek {
		touch-action: none;
	}
	/* Dragging the cover must swipe the player, not lift the image out of it. */
	.bigplayer img {
		-webkit-user-drag: none;
		user-select: none;
	}
	/* Cover art, oversized and blurred to a wash of its own colours. The
	   inset overhang hides the blur's soft edges; the veil is what keeps
	   MTUI's text contrast pairs true over an arbitrary photograph. */
	.bigplayer-wash {
		position: absolute;
		inset: -20%;
		background-position: center;
		background-size: cover;
		filter: blur(64px) saturate(180%);
		transform: scale(1.15);
		opacity: 0.85;
	}
	.bigplayer-wash.plain {
		background-image: radial-gradient(circle at 50% 35%, var(--accent-tint), transparent 70%);
		filter: blur(40px);
	}
	.bigplayer-veil {
		position: absolute;
		inset: 0;
		backdrop-filter: blur(24px);
		/* Weighted towards the bottom, where the transport and the muted
		   labels live — those are the pairs an arbitrary cover can break. */
		background: linear-gradient(
			to bottom,
			color-mix(in srgb, var(--bg) 40%, transparent),
			color-mix(in srgb, var(--bg) 72%, transparent) 55%,
			color-mix(in srgb, var(--bg) 88%, transparent)
		);
	}
	.now-title {
		text-align: center;
		max-inline-size: 100%;
	}
	.now-title .t-card {
		overflow-wrap: anywhere;
	}
	/* Pinned to the corners, which on a phone is where the clock and the
	   camera are — these two spend the safe insets so the buttons stay
	   reachable and visible rather than sliding under the status bar. */
	.bigplayer-close {
		position: absolute;
		inset-block-start: calc(var(--pad) + var(--safe-top-css));
		inset-inline-start: calc(var(--pad) + var(--safe-left-css));
	}
	.bigplayer-actions {
		position: absolute;
		inset-block-start: calc(var(--pad) + var(--safe-top-css));
		inset-inline-end: calc(var(--pad) + var(--safe-right-css));
		width: auto;
	}
	/* A definite width, not `auto`: menu.js anchors popovers by writing
	   `left` while the UA's `right: 0` stays, and an auto width resolves that
	   pair by stretching the popover across the whole window. */
	.volume-pop {
		inline-size: fit-content;
		min-inline-size: 0;
	}
	.volume-icon {
		color: var(--text-muted);
	}
	/* Trailing tick on the active choice; .menu-item is already a flex row. */
	.menu-check {
		margin-inline-start: auto;
		color: var(--accent-text);
	}
	.menu-label {
		display: block;
		padding: var(--sp-8) var(--sp-12) var(--sp-4);
		color: var(--text-muted);
	}
	.bigplayer-body {
		position: relative; /* above the wash and the veil */
		inline-size: min(26rem, 100%);
	}
	.bigplayer-body:not(.dragging) {
		transition: translate var(--t-tab, 350ms) var(--spring, ease);
	}
	.bigplayer-controls {
		inline-size: 100%;
	}
	.swipe-hint {
		color: var(--text-muted);
	}
	/* The cover takes what the window can spare in both axes, so a phone in
	   landscape and a maximised desktop window each get a sane record. */
	.artwork {
		display: grid;
		place-items: center;
		inline-size: min(14rem, 60vw, 42vh);
		aspect-ratio: 1;
		border-radius: var(--r-card);
		background: var(--accent-tint);
		color: var(--accent-text);
		overflow: hidden;
	}
	/* Two columns once there is room beside the cover — a wide window, or a
	   phone turned sideways where stacking would push the transport off. */
	@media (min-width: 900px), (min-width: 620px) and (max-height: 600px) {
		.bigplayer-body {
			inline-size: min(52rem, 100%);
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			align-items: center;
			gap: var(--sp-32);
		}
		.artwork {
			inline-size: min(20rem, 34vw, 62vh);
		}
	}
	/* Nothing but the transport survives a 400px-tall window. */
	@media (max-height: 420px) {
		.swipe-hint {
			display: none;
		}
	}
	.artwork img {
		inline-size: 100%;
		block-size: 100%;
		object-fit: cover;
	}
	.seek {
		inline-size: 100%;
		appearance: none;
		block-size: 6px;
		border-radius: var(--r-card);
		outline-offset: 4px;
	}
	.seek::-webkit-slider-thumb {
		appearance: none;
		inline-size: 16px;
		block-size: 16px;
		border-radius: 50%;
		background: var(--accent);
	}
	.seek::-moz-range-thumb {
		inline-size: 16px;
		block-size: 16px;
		border: none;
		border-radius: 50%;
		background: var(--accent);
	}
	/* A fader, not a scrollbar: `vertical-lr` turns the range on its side and
	   `rtl` puts zero at the bottom, where a volume control's zero belongs.
	   Physical width/height on purpose — the logical axes swap with the
	   writing mode, which is exactly what makes them confusing here. */
	.vslider {
		writing-mode: vertical-lr;
		direction: rtl;
		width: 6px;
		height: 9rem;
		touch-action: none; /* the popover must not scroll while dragging */
	}
</style>
