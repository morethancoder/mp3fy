<script lang="ts">
	import { onMount } from 'svelte';
	import { getVersion } from '@tauri-apps/api/app';
	import { openUrl, openPath } from '@tauri-apps/plugin-opener';
	import {
		isTauri,
		ensureTools,
		toolsReport,
		updateYtdlp,
		downloadsFolder,
		type ToolsStatus,
		type ToolReport
	} from '$lib/api';
	import {
		settings,
		saveSettings,
		AUDIO_FORMATS,
		VIDEO_FORMATS,
		QUALITIES,
		QUALITY_LABEL_KEYS
	} from '$lib/settings.svelte';
	import { m, appLanguage, setAppLanguage, type AppLanguage } from '$lib/i18n.svelte';
	import { loadTheme, saveTheme, type ThemePreference } from '$lib/theme';

	let appVersion = $state('dev');
	let tools = $state<ToolsStatus | null>(null);
	let report = $state<ToolReport[] | null>(null);
	let checking = $state(false);
	let updating = $state(false);
	let theme = $state<ThemePreference>('system');
	let language = $state<AppLanguage>('system');

	onMount(async () => {
		theme = loadTheme();
		language = appLanguage();
		if (!isTauri) return;
		appVersion = await getVersion();
		tools = await ensureTools().catch(() => null);
		void refreshReport();
	});

	// Probing yt-dlp on Android means starting it, so this is never awaited by
	// anything the screen needs in order to paint.
	async function refreshReport() {
		checking = true;
		try {
			report = await toolsReport();
		} catch (err) {
			report = null;
			window.mtui?.toast(String(err), { kind: 'error' });
		} finally {
			checking = false;
		}
	}

	function pickTheme(value: ThemePreference) {
		theme = value;
		saveTheme(value);
	}

	function pickLanguage(value: AppLanguage) {
		language = value;
		setAppLanguage(value);
	}

	async function openFolder() {
		await openPath(await downloadsFolder());
	}

	async function checkForUpdates(e: MouseEvent) {
		const btn = e.currentTarget as HTMLButtonElement;
		const before = report?.find((t) => t.id === 'yt-dlp')?.version ?? null;
		updating = true;
		btn.setAttribute('data-loading', '');
		try {
			const version = await updateYtdlp();
			if (tools) tools.ytdlp_version = version;
			window.mtui?.toast(
				version && version !== before
					? m().settings.updated(version)
					: m().settings.upToDate(version),
				{ kind: 'success' }
			);
			await refreshReport();
		} catch (err) {
			window.mtui?.toast(String(err), { kind: 'error' });
		} finally {
			updating = false;
			btn.removeAttribute('data-loading');
		}
	}
</script>

<div class="screen-stack">
	<h1 class="t-page">{m().settings.title}</h1>

	<h2 class="t-section">{m().settings.appearance}</h2>
	<div class="card">
		<div class="stack" data-gap="16">
			<fieldset class="segmented">
				<label>
					<input
						type="radio"
						name="theme"
						checked={theme === 'light'}
						onchange={() => pickTheme('light')}
					/>
					<span>{m().settings.light}</span>
				</label>
				<label>
					<input
						type="radio"
						name="theme"
						checked={theme === 'dark'}
						onchange={() => pickTheme('dark')}
					/>
					<span>{m().settings.dark}</span>
				</label>
				<label>
					<input
						type="radio"
						name="theme"
						checked={theme === 'system'}
						onchange={() => pickTheme('system')}
					/>
					<span>{m().settings.system}</span>
				</label>
			</fieldset>
			<p class="t-secondary">{m().settings.appearanceHelp}</p>

			<span class="t-label">{m().settings.language}</span>
			<fieldset class="segmented">
				<label>
					<input
						type="radio"
						name="language"
						checked={language === 'en'}
						onchange={() => pickLanguage('en')}
					/>
					<span>{m().settings.english}</span>
				</label>
				<label>
					<input
						type="radio"
						name="language"
						checked={language === 'ar'}
						onchange={() => pickLanguage('ar')}
					/>
					<span>{m().settings.arabic}</span>
				</label>
				<label>
					<input
						type="radio"
						name="language"
						checked={language === 'system'}
						onchange={() => pickLanguage('system')}
					/>
					<span>{m().settings.languageSystem}</span>
				</label>
			</fieldset>
			<p class="t-secondary">{m().settings.languageHelp}</p>
		</div>
	</div>

	<h2 class="t-section">{m().settings.downloads}</h2>
	<div class="card">
		<div class="stack" data-gap="16">
			<x-select>
				<label class="field">
					<span class="t-label">{m().settings.defaultFormat}</span>
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
			<x-select>
				<label class="field">
					<span class="t-label">{m().settings.defaultQuality}</span>
					<span class="select">
						<select bind:value={settings.quality} onchange={saveSettings}>
							{#each QUALITIES as q (q)}
								<option value={q}>{m().quality[QUALITY_LABEL_KEYS[q]]}</option>
							{/each}
						</select>
					</span>
				</label>
			</x-select>
			<div class="row">
				<button class="btn" onclick={openFolder} disabled={!isTauri}>
					{m().settings.openFolder}
				</button>
			</div>
		</div>
	</div>

	<h2 class="t-section">{m().settings.ytdlp}</h2>
	<div class="card">
		<div class="stack" data-gap="16">
			<label class="row" data-align="between">
				<span class="item-text">
					<span class="item-title">{m().settings.autoUpdate}</span>
					<span class="item-sub">{m().settings.autoUpdateHelp}</span>
				</span>
				<input
					type="checkbox"
					class="switch"
					data-feedback
					bind:checked={settings.autoUpdateYtdlp}
					onchange={saveSettings}
				/>
			</label>
			{#if tools && !tools.ffmpeg_available}
				<div class="alert" data-status="warning">
					<span class="icon" data-icon="alert-triangle"></span>
					<div>
						<span class="alert-title">{m().settings.ffmpegMissingTitle}</span>
						<p>{m().settings.ffmpegMissingBody}</p>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<h2 class="t-section">{m().settings.developer}</h2>
	<div class="card">
		<div class="stack" data-gap="16">
			<div class="stack" data-gap="4">
				<span class="t-card">{m().settings.tools}</span>
				<!-- Not an .item-sub: that clamps to one line, and this is the
				     sentence that explains why the panel exists. -->
				<p class="t-secondary">{m().settings.toolsHelp}</p>
			</div>
			{#each report ?? [] as tool (tool.id)}
				<div class="row" data-align="between">
					<span class="item-text">
						<span class="item-title t-ltr">
							{tool.id}
							{#if tool.version}<span class="t-secondary">{tool.version}</span>{/if}
						</span>
						<span class="item-sub">
							{m().settings.toolSource[tool.source]}
							{#if tool.detail}<span class="t-ltr"> · {tool.detail}</span>{/if}
						</span>
					</span>
					<span class="badge" data-status={tool.ok ? 'success' : 'danger'}>
						{tool.ok ? m().settings.toolReady : m().settings.toolMissing}
					</span>
				</div>
			{:else}
				<span class="t-secondary">
					{checking ? m().settings.toolChecking : m().settings.notInstalled}
				</span>
			{/each}
			<div class="row" data-gap="8">
				<button class="btn" onclick={checkForUpdates} disabled={updating || !isTauri}>
					{m().settings.checkForUpdates}
				</button>
				<!-- Icon-only: two full labels side by side break mid-word on a
				     narrow phone, and re-probing is the lesser of the two. -->
				<button
					class="btn"
					data-size="icon"
					onclick={refreshReport}
					disabled={checking || !isTauri}
					aria-label={m().settings.toolRecheck}
					title={m().settings.toolRecheck}
				>
					<span class="icon" data-icon="refresh-cw"></span>
				</button>
			</div>
		</div>
	</div>

	<div class="card">
		<a class="item" href="/logs" style="margin: calc(-1 * var(--sp-16)); inline-size: auto">
			<span class="item-text">
				<span class="item-title">{m().settings.logs}</span>
				<span class="item-sub">{m().settings.logsHelp}</span>
			</span>
			<svg class="chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m9 18 6-6-6-6"/></svg>
		</a>
	</div>

	<h2 class="t-section">{m().settings.about}</h2>
	<div class="card">
		<div class="stack" data-gap="12">
			<span class="t-card t-ltr">mp3fy {appVersion}</span>
			<p class="t-body">{m().settings.aboutBody}</p>
			<p class="t-secondary">{m().settings.aboutStack}</p>
			<div class="row" data-gap="8">
				<button
					class="btn"
					data-variant="ghost"
					onclick={() => openUrl('https://github.com/yt-dlp/yt-dlp')}
				>
					yt-dlp
				</button>
				<button
					class="btn"
					data-variant="ghost"
					onclick={() => openUrl('https://morethancoder.com')}
				>
					morethancoder
				</button>
			</div>
		</div>
	</div>
</div>
