# Changelog

## v0.4.0 — 2026-08-05

- **A notification player on Android.** Playing a track now puts it on the
  notification shade and the lock screen, with cover art, previous /
  play-pause / next, shuffle and the three repeat modes, and a scrubber;
  tapping anywhere that is not a button opens the app. Headset and Bluetooth
  media buttons work for the same reason.

  The web `MediaSession` API mp3fy already spoke was never going to do this:
  Android's WebView implements it and publishes none of it to the system —
  Chrome shows a media notification for a web page because the *browser* wraps
  the page's session in a native one, and a WebView has no browser around it.
  So the session is now native (a foreground service, so a backgrounded app is
  not killed mid-track) while the audio stays where it was, and every button
  comes back to the same functions the in-app player uses.

Verified on API 35, including auto-advancing to the next track with the app in
the background — which turned out to need care, since a track ending pauses
the player for as long as the next file takes to read, and Android will not
let a service that gives up its foreground status take it back on its own.

*(v0.3.0 and v0.3.1 shipped without entries here: Android build fixes, and
playing whole files rather than the first megabyte of them.)*

## v0.2.3 — 2026-08-04

- **Downloads work on 16 KB-page devices.** The bundled ffmpeg cannot load
  there at all (its libraries are 4 KB-aligned and the linker refuses them),
  and yt-dlp only needs ffmpeg to *convert* — so when it cannot run, the
  download now falls back to the audio the site already serves and keeps that
  container, instead of failing after downloading. The library row shows the
  format that was actually produced.
- Fixed a path parser that accepted any `[download] …` line as the finished
  file, so a download with no conversion step ended up named after a progress
  line.

Verified on API 35 (4 KB pages → mp3, as asked) and API 37 `ps16k` (16 KB
pages → a playable `.webm`).

## v0.2.2 — 2026-08-04

Android fixes found by testing the shipped APK rather than a dev build.

- **Sharing a link no longer kills its own download.** Sharing launches the
  app, so the startup yt-dlp update check and the download it just started ran
  at the same time — and on Android yt-dlp is a zip Python imports lazily, so
  rewriting it mid-download killed it (`zipimport.ZipImportError: bad local
  file header`). The update now defers while a download is running.
- **Failures say what went wrong.** The engine often rejects a download
  without a message; yt-dlp's own last error is used instead of an empty
  string.
- ffmpeg and ffprobe are exposed under the names yt-dlp looks for. It ships
  them as `libffmpeg.so` / `libffprobe.so` — the only place Android allows
  executables — and yt-dlp found ffmpeg but never ffprobe, which extracting
  audio needs.

**Known limitation:** on devices with 16 KB memory pages (newer Android 15+
hardware), the bundled ffmpeg cannot load at all — its libraries are 4 KB
aligned and the linker refuses them. The download completes and conversion
fails. Most phones in use today have 4 KB pages and are unaffected.

## v0.2.1 — 2026-08-03

- The Android download is a quarter of the size: releases now ship one APK per
  architecture (57 MB for arm64) instead of one universal 209 MB file
  containing four copies of Python and ffmpeg.

## v0.2.0 — 2026-08-03

Android.

- The app now runs on Android 7+, with yt-dlp, its Python runtime and ffmpeg
  shipped inside the APK — Android does not let an app execute anything it
  downloaded, so the desktop approach could not work there. Downloading,
  metadata, the library and the player all work; the arguments and the
  progress parser are still the desktop ones.
- mp3fy appears in the Android share sheet: share a link from YouTube, a
  browser or a chat and the download starts on arrival. `mp3fy://` links work
  too.
- Converting a local file stays desktop-only for now, and the Android screen
  says so rather than offering a picker that leads nowhere.
- Releases now carry a signed universal APK next to the desktop bundles.

There is no iOS build; [docs/ios.md](docs/ios.md) explains what one would
cost.

## v0.1.0 — 2026-08-03

First public release. Desktop bundles for macOS (universal), Windows and
Linux.

- Paste or type a video link and get an audio file — mp3, m4a, opus, flac or
  wav — or the video itself, converted on your device by yt-dlp and ffmpeg,
  which the app fetches and keeps updated by itself.
- Convert files already on the device to another format.
- Library of everything the app produced, with a full-screen player, mini
  player, playlists, shuffle, repeat and OS media controls.
- Links shared from other apps: `mp3fy://…` opens the app and starts the
  download immediately; links shared during a download queue behind it.
- English and Arabic, with full RTL; light, dark and system themes.
- Nothing leaves the device: no accounts, no telemetry, no server.
