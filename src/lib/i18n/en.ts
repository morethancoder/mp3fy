/**
 * Every English string in the UI, and therefore the shape both languages
 * must fill — `ar.ts` satisfies the type this file defines. Parameterised
 * lines are functions rather than template markers, so a missing argument
 * is a type error instead of a `{placeholder}` shipped to a screen.
 */

export const en = {
	appName: 'mp3fy',

	nav: {
		home: 'Home',
		convert: 'Convert',
		library: 'Library',
		settings: 'Settings'
	},

	home: {
		// Not the app name: the header already carries that, and a screen whose
		// heading repeats it says nothing. The title is what the screen is for.
		title: 'Paste a link, get an audio file',
		subtitle: 'Nothing leaves your device — the conversion happens here.',
		videoLink: 'Video link',
		linkPlaceholder: 'https://…',
		paste: 'Paste',
		pasteFailed: 'Clipboard is empty or unreadable',
		notALink: 'The clipboard does not contain a link',
		clear: 'Clear',
		// A link handed over by another app — the share sheet, a browser, or
		// an "open with" — rather than typed or pasted here.
		sharedStarted: 'Link received — starting the download',
		sharedQueued: 'Link queued — it starts when this download finishes',
		queuedCount: (n: number) =>
			n === 1 ? '1 more link waiting' : `${n} more links waiting`,
		options: 'Options',
		format: 'Format',
		// The audio the site already serves, saved as it arrives. Converting is
		// what costs quality, so the option that does none of it says so.
		formatBest: 'best (original)',
		quality: 'Quality',
		qualityHelp: 'Only applies when converting — “best (original)” never re-encodes.',
		audioFormats: 'Audio',
		videoFormats: 'Video',
		// Asked when a link has already produced a file that is still on disk.
		duplicateTitle: 'You already have this',
		duplicateBody: (title: string) => `“${title}” came from this link.`,
		duplicateAgain: 'Download again',
		duplicateKeep: 'Keep the one I have',
		getAudio: 'Get audio',
		getVideo: 'Get video',
		cancel: 'Cancel',
		failed: 'Download failed',
		savedTo: (folder: string) => `Saved to ${folder}`,
		saved: 'Saved'
	},

	steps: {
		preparing: 'Getting ready — checking yt-dlp and ffmpeg…',
		fetching: 'Fetching video info…',
		downloading: 'Downloading',
		converting: (format: string) => `Converting to ${format} — almost there…`,
		// Nothing is being converted to anything: the audio is being lifted out
		// of what the site served, untouched.
		finishing: 'Saving the audio — almost there…',
		eta: (eta: string) => `${eta} left`,
		of: (size: string) => `of ${size}`
	},

	done: {
		play: 'Play',
		openInFiles: 'Open in Files',
		// Android has no file manager to reveal into: the file is handed to
		// whichever app can play or show it.
		openWith: 'Open with…',
		share: 'Share',
		more: 'More actions',
		dismiss: 'Dismiss',
		shareFallback: 'Sharing is not available here — showing the file instead'
	},

	quality: {
		best: 'Best available',
		high: 'High (320 kbps)',
		standard: 'Standard (192 kbps)',
		small: 'Small (128 kbps)'
	},

	// Everything the app has produced, and the shelf you pick from.
	library: {
		title: 'Library',
		emptyTitle: 'Nothing here yet',
		emptyBody: 'Files you download or convert show up here, ready to play.',
		all: 'All',
		sortRecent: 'Recent',
		sortPlays: 'Most played',
		sortTitle: 'Title',
		playsCount: (n: number) => (n === 1 ? '1 play' : `${n} plays`),
		actions: 'Actions',
		play: 'Play',
		reveal: 'Open in Files',
		share: 'Share',
		remove: 'Remove',
		removed: 'Removed',
		missing: 'File no longer exists on disk',
		openFailed: 'No app on this device can open this file',
		addToPlaylist: 'Add to playlist',
		playlistName: 'Playlist name',
		create: 'Create',
		done: 'Done',
		deletePlaylist: 'Delete playlist'
	},

	// The transport itself — mini dock and the full-screen overlay.
	player: {
		seek: 'Seek',
		play: 'Play',
		pause: 'Pause',
		back10: 'Back 10 seconds',
		forward10: 'Forward 10 seconds',
		previous: 'Previous track',
		next: 'Next track',
		close: 'Minimise player',
		stop: 'Close player',
		nowPlaying: 'Now playing',
		options: 'Playback options',
		shuffle: 'Shuffle',
		repeat: 'Repeat',
		repeatOff: 'Off',
		repeatAll: 'Repeat all',
		repeatOne: 'Repeat one',
		volume: 'Volume',
		swipeHint: 'Swipe sideways to change track, down to minimise',
		failed: 'This file could not be played'
	},

	convert: {
		title: 'Convert a local file',
		subtitle: 'Turn any video or audio file on this device into the format you want.',
		chooseFile: 'Choose file',
		changeFile: 'Change file',
		targetFormat: 'Target format',
		convert: 'Convert',
		converting: 'Converting…',
		preparing: 'Getting ready…',
		failed: 'Conversion failed',
		pickerTitle: 'Choose a video or audio file',
		notOnAndroid: 'Not on Android yet',
		notOnAndroidBody:
			'Converting a file already on your device is desktop-only for now. Downloading from a link — and converting it on the way in — works here.'
	},

	settings: {
		title: 'Settings',
		appearance: 'Appearance',
		light: 'Light',
		dark: 'Dark',
		system: 'System',
		appearanceHelp:
			'System follows the device, and keeps following it if the device switches while the app is open.',
		language: 'App language',
		english: 'English',
		arabic: 'العربية',
		languageSystem: 'System',
		languageHelp: 'System follows the device language, and shows Arabic when the device does.',
		downloads: 'Downloads',
		defaultFormat: 'Default format',
		defaultQuality: 'Default quality',
		openFolder: 'Open downloads folder',
		ytdlp: 'yt-dlp',
		notInstalled: 'not installed yet',
		checkForUpdates: 'Check for updates',
		upToDate: (version: string) => `yt-dlp is up to date (${version})`,
		updated: (version: string) => `yt-dlp updated to ${version}`,
		autoUpdate: 'Update automatically',
		autoUpdateHelp: 'Keep yt-dlp current on every launch',
		ffmpegMissingTitle: 'ffmpeg not found',
		ffmpegMissingBody: 'Conversion needs ffmpeg — it will be fetched on first download.',
		tools: 'Tools',
		toolsHelp:
			'The two programs that do the work. A download that fails for no visible reason is usually an out-of-date yt-dlp — sites change, and last month’s copy gets refused.',
		toolReady: 'Ready',
		toolMissing: 'Missing',
		toolChecking: 'Checking…',
		toolSource: {
			bundled: 'Shipped with the app',
			updated: 'Updated on this device',
			managed: 'Downloaded by the app',
			system: 'Found on this system',
			missing: 'Not installed'
		},
		toolRecheck: 'Re-check',
		about: 'About',
		aboutBody:
			'Turns any video link into an audio file, entirely on your device. Your downloads use your own connection — nothing goes through a server.',
		aboutStack: 'Powered by yt-dlp and ffmpeg. Built with SvelteKit, Tauri and MoreThanUI.',
		developer: 'Developer',
		logs: 'Logs',
		logsHelp: 'What the app and its tools did, newest first.'
	},

	logs: {
		title: 'Logs',
		empty: 'Nothing logged yet',
		refresh: 'Refresh',
		back: 'Back'
	}
};

export type Messages = typeof en;
