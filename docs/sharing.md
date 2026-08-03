# Sharing links into mp3fy

mp3fy answers to its own URL scheme, `mp3fy://`. Opening such a link brings the
running app to the front (or starts it) and begins the download at once, as if
the link had been pasted on the Home screen and *Get* pressed.

Three shapes are accepted, so whatever wraps the link on the way in, the video
URL is found:

```
mp3fy://https://www.youtube.com/watch?v=VIDEO_ID     link appended directly
mp3fy://open?url=https%3A%2F%2Fyoutu.be%2FVIDEO_ID   link as an encoded query
https://youtu.be/VIDEO_ID                            a bare link (mobile share)
```

If a download is already running, the new link joins a queue and starts when
the current one finishes — the Home screen shows how many are waiting.
Pressing *Cancel* stops the current download and drops the queue.

## How each platform delivers it

| Platform | Registration | Delivery |
| --- | --- | --- |
| macOS | `CFBundleURLTypes` in the bundled app's `Info.plist`, written from `plugins.deep-link.desktop.schemes` in `tauri.conf.json` | The running app receives an *Opened* event |
| Windows | Registry keys written by the installer, and by the app at startup | A second launch with the URL as an argument; the single-instance plugin forwards it |
| Linux | `x-scheme-handler/mp3fy` in the desktop database, written by the package and by the app at startup | Same as Windows |

Because macOS registration lives in the app bundle, `mp3fy://` links only work
for an **installed** build — `make dev` runs a bare binary that Launch Services
has never seen. On Windows and Linux the app registers itself at startup, so
dev builds work there too.

## Trying it

```sh
# macOS
open "mp3fy://https://youtu.be/dQw4w9WgXcQ"

# Linux
xdg-open "mp3fy://https://youtu.be/dQw4w9WgXcQ"

# Windows (PowerShell)
Start-Process "mp3fy://https://youtu.be/dQw4w9WgXcQ"
```

## Wiring it to a browser

Any link or bookmarklet that resolves to `mp3fy://…` works. A bookmarklet that
sends the page you are on:

```js
javascript:location.href='mp3fy://open?url='+encodeURIComponent(location.href)
```

## Where this lives in the code

- `src-tauri/src/lib.rs` — registers the single-instance and deep-link plugins,
  and re-registers the scheme at startup on Windows and Linux.
- `src-tauri/tauri.conf.json` — `plugins.deep-link.desktop.schemes`.
- `src/lib/shared-links.ts` — digs the http(s) link out of whatever arrived and
  hands it to the download queue.
- `src/lib/downloads.svelte.ts` — `startWithUrl()` and the queue behind it.

## Android

The bundle identifier (`com.morethancoder.mp3fy`) is fixed for the planned
Android build, where the same handler will also serve `ACTION_SEND` intents —
that is what makes mp3fy appear in the system share sheet. The frontend half is
already platform-agnostic; only the manifest entry is missing.
