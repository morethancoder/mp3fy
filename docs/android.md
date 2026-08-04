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
| yt-dlp | downloaded on first run, `-U` self-update | in the APK, replaced by [the update below](#keeping-yt-dlp-current) |
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

## Keeping yt-dlp current

**This is the single most likely cause of an Android download failing.** The
APK carries whatever yt-dlp youtubedl-android was built with — 0.18.1 ships
**2025.11.12**, and 0.18.1 was still the newest on Maven Central in August
2026, so no dependency bump fixes it (worth re-checking before you believe
that). YouTube changes every few weeks; a copy that old gets refused
with `HTTP Error 403: Forbidden`. Everything below exists so the shipped copy
is only ever a starting point.

The library has its own updater, and it is the one thing here we do **not**
use. It resolves the current release through `api.github.com`, unauthenticated
— 60 calls an hour, counted **per IP**. Phones behind carrier NAT share one IP
with everybody else on the tower, so that quota is routinely spent by strangers
and the call comes back 403 as well. Two unrelated-looking failures, one cause,
and the update failing is what strands the app on the stale yt-dlp.

So the update is done *to* yt-dlp rather than by it:

```
tools.rs::update_ytdlp  (android branch)
  1. GET https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp
     with redirects OFF. The 302's Location is
     …/releases/download/2026.07.04/yt-dlp — the tag, for free, no API call.
  2. same tag as the installed one? stop, nothing to do.
  3. download the file into the app-data bin dir
  4. android_engine::install ──► YtdlpPlugin.install
       copies it to noBackupFiles/youtubedl-android/yt-dlp/yt-dlp,
       calls YoutubeDL.init_ytdlp (which adopts an existing file and only
       unpacks the APK's copy when it finds none), records the tag in prefs
```

Two things that must stay true:

- **`install` takes the engine lock and skips while a download runs.** yt-dlp
  is a zip Python imports lazily; rewriting it mid-download kills that download
  with `zipimport.ZipImportError: bad local file header`. Skipping is right —
  the update also runs unattended at launch, and the next launch retries.
- **The version lives in our own preference**, not the library's. A freshly
  installed APK knows its yt-dlp version only by running it, so that probe
  (`status`, one Python start) happens on the tools screen and nowhere on the
  launch path.

`Settings → Developer → Tools` is where all of this becomes visible: each tool
with a Ready/Missing badge, its version, and where the live copy came from
(*Shipped with the app* / *Updated on this device* / *Downloaded by the app* /
*Found on this system*). Check there first when a download fails for no
apparent reason — "Shipped with the app" months after a release is the answer.

## Icons

Android reads **none** of `src-tauri/icons/`. Its launcher icon lives in
`gen/android/app/src/main/res/mipmap-*`, which is committed, so an icon that is
not regenerated ships as the stock Tauri logo — which is exactly what v0.1.0
through v0.2.3 did.

Always regenerate with `make icons`, never `pnpm tauri icon` alone. The extra
step (`scripts/android-adaptive-icon.py`, needs `uv`) exists because
`tauri icon` writes the whole plum plate as the adaptive-icon *foreground*,
and launchers crop adaptive foregrounds to their middle 67% before applying
their own mask — the plate's corners would be sliced off and the note would
read zoomed in. The script splits the artwork the way the format expects: the
white note alone inset to the safe zone, over a plum gradient in
`drawable/ic_launcher_plate.xml`. That name avoids `ic_launcher_background`,
which `tauri icon` owns as a `@color`.

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

## The emulator

There is **one** AVD on this machine, named `phone`, shared with every other
project. Four app-specific ones had reached 19 GB between them; do not make a
fifth.

```sh
~/Library/Android/sdk/emulator/emulator -avd phone -no-snapshot -no-audio -no-boot-anim &
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 3; done
```

`-no-snapshot` matters: boot snapshots had grown to 3.8 GB on the AVD that
kept them. It is a medium phone — 1080×2400 @420dpi, API 35 `google_apis`
(not a Play Store image, so sideloading is unobstructed), 4 GB RAM, host GPU.
If it is ever lost:

```sh
avdmanager create avd -n phone -k "system-images;android-35;google_apis;arm64-v8a" -d medium_phone
# then in ~/.android/avd/phone.avd/config.ini: hw.gpu.enabled=yes, hw.ramSize=4096,
# hw.keyboard=yes, disk.dataPartition.size=6G — avdmanager's defaults are 2 GB
# of RAM and software rendering.
```

A whole verification run, which is how the yt-dlp update was confirmed:

```sh
make android MODE=debug
adb install -r src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
adb logcat -c && adb shell am start -n com.morethancoder.mp3fy/.MainActivity
adb logcat -d --pid=$(adb shell pidof com.morethancoder.mp3fy | tr -d '\r') | grep -E "mp3fy +: \["
```

Driving the UI without hands: `adb shell input tap X Y` (coordinates in the
`wm size` space) and `adb exec-out screencap -p > shot.png` to see the result.
Type into a field with `adb shell "input text 'https://youtu.be/VIDEO_ID'"` —
**quote it inside the shell command**, or the device's shell eats everything
from the first `.` onward.

Two things that bite:

- Installing over a differently-signed build fails with
  `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. Debug and release keys differ, so
  `adb uninstall com.morethancoder.mp3fy` first when switching between them.
- `adb logcat -s mp3fy:*` is a zsh glob and will not run; use `mp3fy:V`.

The 16 KB verification below used an `android-37.1 ps16k` AVD which no longer
exists. The system image is still installed, so recreating it is
`avdmanager create avd -n phone16k -k
"system-images;android-37.1;google_apis_playstore_ps16k;arm64-v8a" -d medium_phone`
— delete it again afterwards.

## Housekeeping

Android builds are the bulk of what fills the disk: cargo keeps a target tree
per ABI and Gradle keeps its intermediates, together 12.5 GB after a day.
`make clean` takes cargo's target dir, `gen/android/app/build`,
`gen/android/.gradle`, `.svelte-kit`, `build` and `.playwright`, and prints
what each freed. Run it when a session ends rather than a month later.

## 16 KB page sizes

Newer Android hardware (15+) uses 16 KB memory pages. The ffmpeg that
youtubedl-android 0.18.1 *unpacks at runtime* is built with 4 KB alignment, so
the linker refuses it outright:

```
"…/packages/ffmpeg/usr/lib/libwebp.so" program alignment (4096)
cannot be smaller than system page size (16384)
CANNOT LINK EXECUTABLE ".../ffprobe"
```

The library declares 16 KB support from 0.18.0, and its *APK* libraries are
aligned — but Play's tooling only checks those, not the payload extracted at
runtime, so the ffmpeg that actually runs was never rebuilt. Bumping the
version does not help, and Android will not execute an ffmpeg downloaded at
runtime (W^X), so mp3fy cannot fetch a corrected one either. Fixing it
properly means shipping our own 16 KB-aligned ffmpeg build.

Until then the app **degrades instead of failing**: yt-dlp only needs ffmpeg
to *convert*, so when ffmpeg cannot run, the download is retried asking for
the audio the site already serves (`-f bestaudio`) and the file keeps its own
container — usually opus in `.webm`, which the webview plays. The library row
shows the real format, not the one that was requested.

Verified on both: API 35 (4 KB) produces the requested mp3; API 37 `ps16k`
(16 KB) produces a playable `.webm`.

## Not done yet

- **Play Store**: needs an AAB, a developer account, and a policy argument
  about downloader apps. Sideloading is the supported route today.
- **Convert**: the file picker returns a `content://` URI that ffmpeg cannot
  open, and the engine's ffmpeg is only reachable through yt-dlp. Doable, not
  done.
- **MediaStore**: files land in app-external storage, so they are visible in
  Files but not in the system music library, and are removed when the app is
  uninstalled.
