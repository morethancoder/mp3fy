# Android

The same app, a different engine.

## Why the engine is different

On desktop mp3fy downloads a yt-dlp binary into its app-data folder and runs
it. On Android that is impossible twice over:

1. **yt-dlp publishes no Android binary.** Its releases cover macOS, Windows
   and Linux (glibc and musl). yt-dlp is a Python program, and Android has no
   Python.
2. **Android forbids it anyway.** Since API 29, an app may not execute a file
   from its own writable storage (W^X). Executables have to live in the APK's
   native-library directory, which only the installer can write.

So the Android build ships the engine inside the APK — yt-dlp, a Python
runtime and ffmpeg, packaged as native libraries by
[youtubedl-android](https://github.com/yausername/youtubedl-android) (the
library behind Seal). The system unpacks them to a read-only, executable
location, and they run from there.

## How it fits together

```
src/lib/downloads.svelte.ts        unchanged — the UI knows nothing about this
  └─ start_download            (Rust, download.rs)
       ├─ desktop: spawn yt-dlp, read stdout
       └─ android: android_engine.rs ──► YtdlpPlugin.kt ──► YoutubeDL.execute
                     ▲                                          │
                     └────────── one output line at a time ◄─────┘
                                 (Tauri channel)
```

The split is deliberate: **Kotlin only starts and stops the process.** The
argument list is built in `download.rs` exactly as it is for desktop, and each
output line is streamed back to the same parser that turns
`[download]  45.2% of ~10.55MiB at 2.35MiB/s ETA 00:05` into a progress event.
One definition of a download, two ways of launching it.

| Concern | Desktop | Android |
| --- | --- | --- |
| yt-dlp | downloaded on first run, `-U` self-update | in the APK, updated by the engine |
| ffmpeg | downloaded if the system has none | in the APK |
| Output | `Downloads/mp3fy` | app-external `Download/mp3fy` (no permission needed, and what Tauri's `$DOWNLOAD` resolves to, so the asset-protocol scope already covers it) |
| Convert screen | works | says it is desktop-only — ffmpeg is only reachable through a download |
| Shared links | `mp3fy://` | `mp3fy://` **and** the system share sheet (`ACTION_SEND`) |

## Building

```sh
make android            # signed release APK (needs key.properties, below)
make android MODE=debug # arm64 debug APK, much faster
make android MODE=dev   # run on a connected device or emulator
```

`src-tauri/gen/android` is committed, unlike `gen/apple` — it carries the
engine dependency, `YtdlpPlugin.kt`, the share intent filter and the signing
config, all of which `tauri android init` would regenerate away.

Releases ship one APK per architecture rather than a universal one: the
engine's Python and ffmpeg payloads are ~50 MB *per ABI*, so a universal build
came to 209 MB of which any given phone used a quarter. The unsuffixed
`mp3fy_<version>_android.apk` is arm64.

R8 is **off** for release builds. Nearly all of a 57 MB APK is native payload,
so shrinking the Java side saves a couple of megabytes — while the engine,
Tauri's plugin loading and Jackson are all reflection-driven. With R8 on, the
APK installed fine and then died in `ZipUtils.unzip` with
`NoClassDefFoundError`. The keep rules are still in `proguard-rules.pro` for
anyone who tries again.

## Debugging

`logs::log` writes to logcat as well as to the in-app Logs screen:

```sh
adb logcat -s mp3fy:V          # everything the app and yt-dlp did
adb logcat -s AndroidRuntime:E # crashes
```

Testing the two share paths without a phone:

```sh
adb shell am start -a android.intent.action.SEND -t text/plain \
  --es android.intent.extra.TEXT "https://youtu.be/VIDEO_ID" \
  -n com.morethancoder.mp3fy/.MainActivity

adb shell am start -a android.intent.action.VIEW -d "mp3fy://https://youtu.be/VIDEO_ID"
```

Note that Android rewrites `mp3fy://https://x` to `mp3fy://https//x`, eating
the inner colon — exactly as macOS does. `src/lib/shared-links.ts` repairs it.

## Signing

Release APKs are signed with a key that is **not** in the repo:

- locally: `~/.mp3fy/mp3fy-release.jks`, referenced by
  `src-tauri/gen/android/key.properties` (gitignored)
- in CI: restored from the `ANDROID_KEYSTORE_BASE64`,
  `ANDROID_KEYSTORE_PASSWORD` and `ANDROID_KEY_ALIAS` repository secrets

**Back that keystore up.** Android identifies an app by its signing key: lose
it and no future build can ever update an installed mp3fy — every user has to
uninstall first. The GitHub secret is a copy, so it is a backup of last
resort, not a plan.

## Not done yet

- **Play Store**: needs an AAB, a developer account, and a policy argument
  about downloader apps. Sideloading is the supported route today.
- **Convert**: the file picker returns a `content://` URI that ffmpeg cannot
  open, and the engine's ffmpeg is only reachable through yt-dlp. Doable, not
  done.
- **MediaStore**: files land in app-external storage, so they are visible in
  Files but not in the system music library, and are removed when the app is
  uninstalled.
