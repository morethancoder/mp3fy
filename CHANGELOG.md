# Changelog

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
