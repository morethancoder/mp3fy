<script lang="ts">
	import { onMount } from 'svelte';
	import { isTauri, getLogs, type LogEntry } from '$lib/api';
	import { m, locale } from '$lib/i18n.svelte';

	let logs = $state<LogEntry[]>([]);

	const TINTS: Record<string, string> = {
		tools: 'butter',
		download: 'sky',
		convert: 'mint',
		'yt-dlp': 'rose',
		ffmpeg: 'rose',
		ui: 'lavender'
	};

	function stamp(ts: number): string {
		return new Intl.DateTimeFormat(locale() === 'ar' ? 'ar' : 'en', {
			dateStyle: 'short',
			timeStyle: 'medium'
		}).format(new Date(ts));
	}

	async function refresh() {
		if (!isTauri) return;
		logs = await getLogs().catch(() => []);
	}

	onMount(refresh);
</script>

<div class="screen-stack">
	<div class="row" data-align="between">
		<div class="row" data-gap="8">
			<a class="btn" data-size="icon" data-variant="ghost" href="/settings" aria-label={m().logs.back}>
				<span class="icon" data-icon="chevron-left"></span>
			</a>
			<h1 class="t-page" style="margin: 0">{m().logs.title}</h1>
		</div>
		<button class="btn" onclick={refresh}>{m().logs.refresh}</button>
	</div>

	{#if logs.length === 0}
		<div class="empty">
			<span class="empty-icon">
				<span class="icon" data-icon="info" role="img" aria-label={m().logs.title}></span>
			</span>
			<span class="t-card">{m().logs.empty}</span>
		</div>
	{:else}
		<div class="stack" data-gap="8">
			{#each logs as entry (entry.ts + entry.message)}
				<div class="card">
					<div class="stack" data-gap="4">
						<div class="row" data-align="between" data-gap="8">
							<span class="badge" data-tint={TINTS[entry.source] ?? 'lavender'}>
								{entry.source}
							</span>
							<span class="t-label t-ltr">{stamp(entry.ts)}</span>
						</div>
						<code class="code-inline t-ltr" style="overflow-wrap: anywhere">
							{entry.message}
						</code>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
