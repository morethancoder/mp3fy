# iOS: what it would take

Research notes, not a plan of record. No iOS code exists in this repo.

## The short version

An iOS mp3fy is **possible but expensive**, and the hard part is not the
download engine — it is distribution. Nothing about it is a weekend.

## Why the desktop and Android engines both fail here

iOS apps cannot `fork`/`exec` another executable. The desktop design (fetch a
yt-dlp binary, run it, read its stdout) is out, and so is Android's (ship the
binary in the package and run it from a read-only directory). There is no
process to run.

What iOS *does* allow is code running **inside the app process**. That is the
loophole [a-Shell](https://apps.apple.com/app/id1473805438) uses: it embeds a
CPython interpreter, so `pip install yt-dlp` and running it works on an iPad
today. yt-dlp is pure Python — it does not need to be a subprocess, it needs
an interpreter.

So the engine would be:

| Piece | Desktop | Android | iOS would need |
| --- | --- | --- | --- |
| Python | not needed (binary) | in the APK, exec'd | CPython built for iOS, linked into the app ([python-apple-support](https://github.com/beeware/Python-Apple-support)) |
| yt-dlp | binary | in the APK, exec'd | the pure-Python package, imported and driven in-process |
| ffmpeg | binary | in the APK, exec'd | linked as a library and called through its API |
| Progress | parse stdout | parse stdout | Python callbacks/hooks — no stdout to parse |

That last row is the one that hurts: `download.rs` currently earns its keep by
parsing yt-dlp's output, and both existing platforms share that parser. iOS
would need a second way of learning what the engine is doing (yt-dlp's
`progress_hooks`), bridged Swift → Rust.

### ffmpeg on iOS is its own problem

FFmpegKit — the library everyone used for this — was **retired on 6 January
2025**, and its prebuilt binaries were pulled from CocoaPods and Maven in
April 2025. What is left is community forks (FFmpegKitNext,
`ffmpeg-kit-ios-full`) with no clear successor, or building ffmpeg for iOS
yourself (e.g. `FFmpeg-iOS` via SwiftPM). Whichever way, it is a linked
library with a C API, not a command line — so mp3fy's "hand yt-dlp an
`--audio-format` flag and let it call ffmpeg" approach does not survive
either.

## The actual wall: getting it onto a phone

Even finished, an iOS build cannot be handed out the way the APK is.

| Route | Cost | Reality |
| --- | --- | --- |
| App Store | $99/yr + review | A YouTube downloader is very unlikely to pass review. This is the usual outcome for this category. |
| TestFlight | $99/yr + review for external testers | Same review problem; internal testers only sidesteps it for ~100 people you control. |
| Ad-hoc | $99/yr | 100 devices per year, each registered by UDID by hand. |
| Free personal signing | free | Works, expires after **7 days**, max 3 apps, requires a Mac and a cable to refresh. AltStore/SideStore automate the refresh but not the expiry. |
| EU alternative marketplace | $99/yr + notarisation + DMA obligations | Only for users in the EU, and it means becoming a distributor. |

That is the difference from Android in one line: on Android, "download the
APK and open it" is a supported thing a normal person can do. On iOS there is
no equivalent.

## If it were done anyway

Rough order, each step verifiable on its own:

1. `tauri ios init`; get the existing UI running in the simulator. (Cheap —
   this part is just Tauri, and everything except downloading would work.)
2. Vendor a CPython framework for iOS + the yt-dlp package; prove an
   extraction runs in-process from Swift.
3. Pick an ffmpeg library, prove one audio extraction with it.
4. Write the Tauri iOS plugin mirroring `YtdlpPlugin.kt` — same command
   names, so `android_engine.rs` becomes `mobile_engine.rs` with two backends
   and `download.rs` barely changes.
5. Replace stdout parsing with yt-dlp's progress hooks on that path.
6. Decide the distribution route **before** step 2 — it determines whether
   any of this reaches a phone.

## Recommendation

Not now. The engine work is real but tractable; the distribution story is
what makes it poor value next to what the same effort buys elsewhere (Play
Store listing, MediaStore integration, the Convert screen on Android). If an
iOS build is wanted for personal use only, the honest cheapest path is
a-Shell plus a Shortcut — the app would be doing the same thing a-Shell
already does, with a nicer face and a 7-day expiry.
