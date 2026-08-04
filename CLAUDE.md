# mp3fy — project notes for Claude

Turn any video link into a local audio file. SvelteKit (Svelte 5 runes) +
Tauri 2 + morethanui, pnpm. Same stack as `../transcribe`, deliberately
trimmed: no Node-server build target, desktop first.

- yt-dlp and (if the system lacks one) ffmpeg are downloaded on first run
  into the app data dir (`bin/`) and yt-dlp self-updates with `-U` —
  everything runs on the user's device with the user's IP. Logic lives in
  `src-tauri/src/tools.rs`; the download pipeline (progress events
  `download:progress|done|error`) in `src-tauri/src/download.rs`.
- Bundle identifier `com.morethancoder.mp3fy` is permanent — Android support
  is planned later and changing it breaks in-place updates.
- UI follows morethanui's canon (`node_modules/morethanui/llms.txt`): shell
  layout, screen-stack presets, plum accent set in `src/app.html`. Four tabs:
  Home, Convert, Library, Settings. There is no History screen — /library is
  the one list of everything the app produced (audio plays in place, video
  hands off to the file manager) and the per-row ⋮ is its action menu.
- Theme (light/dark/system) is chosen in Settings → Appearance and nowhere
  else — the shell header carries only the app name. A header toggle can't
  express "System" (the default), so it was removed rather than duplicated.
  Theme lives in `src/lib/theme.ts`, app language
  (en/ar/system, RTL for Arabic) in `src/lib/i18n.svelte.ts` + `src/lib/i18n/`
  — both mirrored by the boot script in `src/app.html` (same localStorage
  keys) to avoid first-paint flashes. The i18n locale is resolved at module
  import time, NOT in onMount — x-select paints its face from option text at
  enhancement, so the locale must be right before first render.
- Download state is module-level too (`src/lib/downloads.svelte.ts`,
  subscribed once from +layout's onMount). yt-dlp always ran detached in
  Rust, but the events used to be handled in the Home component, so leaving
  the tab lost the result — keep job state out of screens.
- The player (`src/lib/player.svelte.ts`) is a module-level <audio> so
  playback survives tab navigation; Media Session wiring gives OS media
  controls / mobile notification player where the webview supports it. Local
  files play via `convertFileSrc` — requires the asset protocol scope in
  tauri.conf.json. Shuffle/repeat/volume persist to `mp3fy-player` — there is
  no mute toggle, a volume slider at zero is silence; `play()`
  opens the overlay, the internal `start()` doesn't (auto-advance must not
  throw the big player over what you were doing). The big player is a global
  overlay in +layout.svelte (player.expanded) washed in the cover art,
  blurred; vertical swipe (and wheel) walks tracks — pointer capture is
  required or the cover starts a native image drag, and both drag surfaces
  set `user-select: none`. Its top corner holds the only two non-transport
  controls: a volume popover and one options menu (shuffle + the three repeat
  modes) — the volume slider is vertical (`writing-mode: vertical-lr` +
  `direction: rtl`, physical width/height on purpose) and its popover needs a
  definite width or menu.js's `left` plus the UA's `right: 0` stretch it across
  the window. Collapsing leaves a mini player docked as a bottom drawer above
  the tab bar; its ✕ calls `stop()` (the only way to put the drawer down).
  Wide or short-and-landscape windows put the cover beside the transport —
  `.bigplayer-body` becomes a grid. Playlists in `src/lib/playlists.svelte.ts`.
- Links shared from other apps arrive as `mp3fy://…` (deep-link plugin;
  single-instance forwards them on Windows/Linux, macOS gets an event) and
  start downloading immediately — `src/lib/shared-links.ts`, docs in
  `docs/sharing.md`. macOS normalises `mp3fy://https://x` to `mp3fy://https//x`,
  so the parser repairs the eaten colon; test with `open "mp3fy://…"` against
  an **installed** bundle, never `make dev` (Launch Services only knows
  bundles). Links shared mid-download queue in `download.queued`.
- Sound: MTUI's `data-feedback` fires its `success` cue on click, which
  collided with job-completion feedback — buttons here opt into
  `data-feedback="tick"` and finishing plays `chime()` from
  `src/lib/feedback.ts`. Completion toasts pass no `kind` for the same
  reason. The mute switch stays MTUI's, never a second one.
- Output goes to Downloads/mp3fy (`tools::downloads_dir`). History is
  localStorage (`src/lib/history.svelte.ts`) with artist/thumbnail (fetched
  in parallel with each download via fetch_info) and play counts.
- Tool checks are cached per session in `tools::CACHE` — first ensure probes
  or installs, later downloads start instantly. `tools_report` is the opposite
  and feeds Settings → Developer → Tools: it probes, installs nothing, and says
  which copy of each tool is live. Updating yt-dlp on Android is done *to* it,
  not by it (`-U` can't run from storage Android won't execute): Rust resolves
  `releases/latest/download/yt-dlp` — the redirect names the tag, so no
  api.github.com call and none of its 60-per-hour-per-IP quota, which carrier
  NAT makes a coin flip — and the engine's `install` command swaps the file in.
  The APK's own yt-dlp is whatever youtubedl-android 0.18.1 shipped
  (2025.11.12), so without a working update every download 403s eventually.
  In-memory logs ring buffer
  (`src-tauri/src/logs.rs`) surfaces at Settings → Developer → Logs (/logs);
  frontend errors are forwarded via the log_event command. Every entry is also
  echoed to stderr, which is how you watch a bundled build:
  `./src-tauri/target/release/bundle/macos/mp3fy.app/Contents/MacOS/mp3fy`.
- MTUI bugs worked around in app.css (see fixes/*.md before "fixing" them):
  nav placement/styling, alert data-status colors losing to source order, and
  js/menu.js anchoring popovers with `left` while the UA's `right: 0` wins in
  RTL. Segmented labels are also dropped to `--fs-label` there — at control
  size they wrap inside their own pill.
- App settings in `src/lib/settings.svelte.ts` (localStorage).
- `vite preview` caches the SPA fallback HTML — restart it after a rebuild
  before browser-testing, or you'll debug a stale bundle.
- `src-tauri/icons/*` are generated placeholders — replace `app-icon.png` with
  real branding later and run `make icons`, never `pnpm tauri icon` alone.
  Android reads none of `src-tauri/icons/`: its launcher icon lives in
  `gen/android/.../res/mipmap-*`, which is committed, so anything not
  regenerated ships as the stock Tauri logo (that's how v0.1.0–v0.2.3 went out).
  `tauri icon` also hands Android the whole plum plate as the adaptive-icon
  foreground, which the launcher then crops to the middle 67% and masks itself —
  so `scripts/android-adaptive-icon.py` (run by `make icons`, needs `uv`) splits
  it: white note inset as `mipmap-*/ic_launcher_foreground.png`, plum gradient as
  `drawable/ic_launcher_plate.xml`. It deliberately avoids the name
  `ic_launcher_background` — `tauri icon` owns that one as a `@color`.

- Build output eats disk fast and never shrinks on its own: cargo keeps a tree
  per target (host debug + release + one per Android ABI) and Gradle keeps its
  intermediates, which together had reached 12GB. `[profile.dev]` in Cargo.toml
  gives dependencies no debug info at all (6.5GB → 1.4GB; our own frames keep
  line tables, so backtraces still name file and line). Run `make clean` after
  a debugging or emulator session — it takes the Gradle output too, and prints
  what it freed.

The Makefile is the CLI (one-word targets, `##` self-docs, run bare `make`
for the list): `make dev` runs the desktop app, `make web` just the UI in a
browser, `make check` type-checks both sides, `make build` bundles,
`make release` bumps/tags/pushes and lets `.github/workflows/release.yml`
build macOS (universal), Windows and Linux bundles onto a GitHub Release
(`docs/releasing.md`). Longer flows live in `scripts/<verb>.sh` sourcing
`scripts/_lib.sh`. Keep `make check` clean before committing.
