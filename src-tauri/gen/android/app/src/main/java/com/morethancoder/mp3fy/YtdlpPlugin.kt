package com.morethancoder.mp3fy

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Environment
import android.webkit.MimeTypeMap
import android.webkit.WebView
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLRequest
import java.io.File
import kotlin.concurrent.thread

/**
 * The download engine on Android.
 *
 * On desktop mp3fy downloads a yt-dlp binary into its app-data folder and
 * runs it. Android forbids executing anything from an app's writable storage,
 * so here yt-dlp — plus the Python runtime it needs and ffmpeg — is shipped
 * inside the APK as native libraries and started through youtubedl-android.
 *
 * The split with Rust is deliberate: this class only starts and stops the
 * process. Every argument is built in Rust, and every output line is handed
 * straight back over a channel to the same parser the desktop build uses, so
 * both platforms share one definition of what a download looks like.
 */
@InvokeArg
class InfoArgs {
    lateinit var url: String
}

@InvokeArg
class RunArgs {
    var args: List<String> = listOf()
    lateinit var onLine: Channel
    var processId: String = "mp3fy"
}

@InvokeArg
class CancelArgs {
    var processId: String = "mp3fy"
}

@InvokeArg
class OpenArgs {
    lateinit var path: String
}

@InvokeArg
class InstallArgs {
    /** A yt-dlp release file Rust has already downloaded. */
    lateinit var path: String

    /** The release tag it came from — what the app reports as the version. */
    var version: String = ""
}

@TauriPlugin
class YtdlpPlugin(private val activity: Activity) : Plugin(activity) {
    private companion object {
        /** Where the version of an installed yt-dlp is remembered. */
        const val VERSION_KEY = "ytdlpVersion"
    }

    private var started = false

    /** Cache for [version] — the preference read is cheap, this is cheaper. */
    private var knownVersion: String? = null

    /**
     * Held while anything replaces the yt-dlp package on disk, and briefly
     * when a download starts, so the two can never overlap.
     *
     * On desktop, updating yt-dlp during a download is harmless — the running
     * process keeps the file it opened. Here yt-dlp is a zip that Python
     * imports lazily, so rewriting it mid-download gets the download killed
     * with `zipimport.ZipImportError: bad local file header`. Sharing a link
     * makes this the *common* case: the launch-time update check and the
     * share's download start within milliseconds of each other.
     */
    private val engineLock = Any()

    /** Downloads currently running; an update defers rather than break one. */
    private val running = java.util.concurrent.atomic.AtomicInteger(0)

    /**
     * A link someone shared into mp3fy from another app, waiting to be
     * collected. The share sheet delivers ACTION_SEND — which the deep-link
     * plugin does not handle, since it is not a URL open — so it is picked up
     * here and the frontend asks for it on launch and on every resume.
     */
    private var sharedText: String? = null

    override fun load(webView: WebView) {
        takeShare(activity.intent)
    }

    override fun onNewIntent(intent: Intent) {
        takeShare(intent)
    }

    private fun takeShare(intent: Intent?) {
        if (intent?.action != Intent.ACTION_SEND) return
        val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
        sharedText = text
    }

    /**
     * A directory holding `ffmpeg` and `ffprobe` under the names yt-dlp looks
     * for.
     *
     * Android only executes files from the APK's native library directory, so
     * the engine ships them as `libffmpeg.so` and `libffprobe.so`. yt-dlp is
     * given `--ffmpeg-location` pointing at `libffmpeg.so` and recognises that
     * one by the "ffmpeg" inside its name — then looks for a sibling called
     * plain `ffprobe`, finds nothing, and extracting audio dies with
     * "expected str, bytes or os.PathLike object, not NoneType" *after* the
     * download has already finished.
     *
     * Symlinks fix it without copying 300KB or breaking W^X: the link lives in
     * app storage, but the file that actually executes is still the read-only
     * one inside the APK.
     */
    private fun ffmpegBinDir(): File {
        val dir = File(activity.filesDir, "ffmpeg-bin")
        dir.mkdirs()
        val nativeDir = File(activity.applicationInfo.nativeLibraryDir)
        for ((name, lib) in listOf("ffmpeg" to "libffmpeg.so", "ffprobe" to "libffprobe.so")) {
            val target = File(nativeDir, lib)
            val link = File(dir, name)
            if (!target.exists()) continue
            // The APK path changes on every update, so a stale link is worse
            // than no link: check where it actually points.
            if (link.exists() && link.canonicalPath == target.canonicalPath) continue
            try {
                link.delete()
                android.system.Os.symlink(target.absolutePath, link.absolutePath)
            } catch (e: Exception) {
                android.util.Log.w("mp3fy", "[engine] could not link $name: ${e.message}")
            }
        }
        return dir
    }

    /** Hand over the pending shared text, once. */
    @Command
    fun sharedLink(invoke: Invoke) {
        val ret = JSObject()
        ret.put("text", sharedText)
        sharedText = null
        invoke.resolve(ret)
    }

    /**
     * How much of the screen the system is sitting on, in CSS pixels.
     *
     * The web platform has an answer for this — `env(safe-area-inset-*)` — and
     * MoreThanUI's shell already uses it. On Android WebView it is not enough:
     * those values only ever describe the *display cutout*, and the status and
     * navigation bars are invisible to CSS. MainActivity draws the app edge to
     * edge, so without this the header sits under the clock and the player's
     * close button lands on the notch.
     *
     * The IME is deliberately not included: a keyboard sliding up must not
     * repaint the whole shell.
     */
    @Command
    fun insets(invoke: Invoke) {
        activity.runOnUiThread {
            try {
                val bars = ViewCompat.getRootWindowInsets(activity.window.decorView)?.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
                )
                val density = activity.resources.displayMetrics.density
                invoke.resolve(JSObject().apply {
                    put("top", (bars?.top ?: 0) / density)
                    put("bottom", (bars?.bottom ?: 0) / density)
                    put("left", (bars?.left ?: 0) / density)
                    put("right", (bars?.right ?: 0) / density)
                })
            } catch (e: Exception) {
                invoke.reject(describe(e, "the window insets could not be read"))
            }
        }
    }

    /**
     * Hand a finished file to whatever app can play or show it.
     *
     * Desktop reveals the file in the file manager; Android has no such thing,
     * and the opener plugin says as much — `reveal_item_in_dir` is documented
     * unsupported here and simply fails, which the UI used to report as "file
     * no longer exists on disk" over a file that was sitting right there.
     *
     * Sending the path straight out would not work either: a `file://` URI in
     * an intent is a FileUriExposedException since API 24. The FileProvider in
     * the manifest is what turns it into a `content://` URI the receiving app
     * is granted permission to read.
     */
    @Command
    fun openFile(invoke: Invoke) {
        val args = invoke.parseArgs(OpenArgs::class.java)
        try {
            val file = File(args.path)
            if (!file.isFile) {
                invoke.reject("the file is no longer on this device")
                return
            }
            val uri = FileProvider.getUriForFile(
                activity,
                "${activity.packageName}.fileprovider",
                file
            )
            val extension = file.extension.lowercase()
            val mime = MimeTypeMap.getSingleton().getMimeTypeFromExtension(extension)
                ?: "application/octet-stream"
            val view = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, mime)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            // A chooser rather than a bare ACTION_VIEW: it never throws when
            // nothing on the device claims the type, and "open with" is the
            // honest wording for handing a file to another app.
            val chooser = Intent.createChooser(view, file.name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            activity.startActivity(chooser)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject(describe(e, "no app on this device could open the file"))
        }
    }

    /**
     * Unpacks the engine on first use; later calls are cheap.
     *
     * Synchronized because two callers really do arrive at once: sharing a
     * link launches the app, so the startup tools check and the download that
     * the share just started both ask for the engine within milliseconds.
     * Unsynchronized, both threads got past the flag and unpacked ffmpeg on
     * top of each other — yt-dlp then finished the download and died in
     * post-processing with "expected str, bytes or os.PathLike object, not
     * NoneType", which is what a missing ffmpeg looks like from Python.
     */
    @Synchronized
    private fun start() {
        if (started) return
        val t0 = System.currentTimeMillis()
        YoutubeDL.getInstance().init(activity.applicationContext)
        val t1 = System.currentTimeMillis()
        FFmpeg.getInstance().init(activity.applicationContext)
        val t2 = System.currentTimeMillis()
        android.util.Log.i("mp3fy", "[engine] init: yt-dlp ${t1 - t0}ms, ffmpeg ${t2 - t1}ms")
        started = true
    }

    /**
     * Where finished files are written: app-owned external storage, so there
     * is no permission prompt and the Files app can still browse it.
     *
     * DIRECTORY_DOWNLOADS specifically, because that is what Tauri resolves
     * the DOWNLOAD path variable to on Android — which makes the
     * asset-protocol scope the app already declares for that variable cover
     * these files, and lets the player play what the engine just produced.
     */
    private fun outputDir(): File {
        val dir = File(
            activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)
                ?: activity.filesDir,
            "mp3fy"
        )
        dir.mkdirs()
        return dir
    }

    @Command
    fun setup(invoke: Invoke) {
        try {
            start()
            val ret = JSObject()
            ret.put("version", version())
            ret.put("outputDir", outputDir().absolutePath)
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject(describe(e, "the download engine could not start"))
        }
    }

    /**
     * Put a yt-dlp that Rust downloaded in place of the one in use.
     *
     * The engine library ships its own updater, but that one asks
     * api.github.com which release is current — an unauthenticated call, and
     * therefore 60 an hour *per IP*. Phones share carrier IPs with thousands of
     * strangers, so the answer is frequently 403 and the update simply fails,
     * which strands the app on the yt-dlp the APK was built with. Rust fetches
     * the release file directly instead (no API, no quota) and hands it here,
     * so this only has to do what the library's updater does with it: drop it
     * in the engine's yt-dlp directory and re-point the engine at it.
     */
    @Command
    fun install(invoke: Invoke) {
        val args = invoke.parseArgs(InstallArgs::class.java)
        thread {
            try {
                start()
                val source = File(args.path)
                if (!source.isFile) {
                    invoke.reject("the downloaded yt-dlp is missing")
                    return@thread
                }
                var installed = false
                synchronized(engineLock) {
                    // A download is reading the package we would replace.
                    // Skipping is right: this also runs unattended at launch,
                    // and the next launch will try again.
                    if (running.get() == 0) {
                        val dir = File(
                            File(activity.applicationContext.noBackupFilesDir, YoutubeDL.baseName),
                            YoutubeDL.ytdlpDirName
                        )
                        dir.mkdirs()
                        source.copyTo(File(dir, YoutubeDL.ytdlpBin), overwrite = true)
                        // init_ytdlp keeps whatever is already in the directory
                        // and only unpacks the copy inside the APK when it finds
                        // nothing — so this adopts the new file rather than
                        // overwriting it back.
                        YoutubeDL.getInstance().init_ytdlp(activity.applicationContext, dir)
                        rememberVersion(args.version)
                        installed = true
                    }
                }
                source.delete()
                invoke.resolve(JSObject().apply {
                    put("version", version())
                    put("installed", installed)
                })
            } catch (e: Exception) {
                invoke.reject(describe(e, "the update could not be installed"))
            }
        }
    }

    /** What each half of the engine is, and whether it is actually there. */
    @Command
    fun status(invoke: Invoke) {
        thread {
            try {
                start()
                val nativeDir = File(activity.applicationInfo.nativeLibraryDir)
                invoke.resolve(JSObject().apply {
                    put("version", version().ifEmpty { probeVersion() })
                    put("updated", prefs().contains(VERSION_KEY))
                    put("ffmpeg", File(nativeDir, "libffmpeg.so").isFile)
                    put("ffprobe", File(nativeDir, "libffprobe.so").isFile)
                })
            } catch (e: Exception) {
                invoke.reject(describe(e, "the download engine could not start"))
            }
        }
    }

    private fun prefs() = activity.getSharedPreferences("mp3fy", Context.MODE_PRIVATE)

    private fun rememberVersion(version: String) {
        knownVersion = version
        prefs().edit().putString(VERSION_KEY, version).apply()
    }

    /**
     * The version we can state without paying for it: whatever the last
     * install recorded. Empty means the APK's own copy is still in place —
     * which knows its version only by being run, so [probeVersion] does that
     * and nothing on the launch path has to.
     */
    private fun version(): String {
        knownVersion?.let { return it }
        val stored = prefs().getString(VERSION_KEY, null)
        if (stored != null) knownVersion = stored
        return stored ?: ""
    }

    /** Ask yt-dlp itself. Costs a Python start, so it is never on a hot path. */
    private fun probeVersion(): String {
        return try {
            val request = YoutubeDLRequest(emptyList()).addCommands(listOf("--version"))
            val response = YoutubeDL.getInstance().execute(request, "mp3fy-version", false) { _, _, _ -> }
            response.out.trim().lines().lastOrNull { it.isNotBlank() }?.trim().orEmpty()
        } catch (e: Exception) {
            android.util.Log.w("mp3fy", "[engine] could not read the yt-dlp version: ${e.message}")
            ""
        }
    }

    /**
     * A message worth showing. Plenty of what the engine throws (IOException
     * from a dead connection, most of what Jackson raises) carries a null
     * message, and "null" on screen tells nobody anything — the class name at
     * least names the failure.
     */
    private fun describe(e: Exception, fallback: String): String {
        val message = e.message?.trim()
        if (!message.isNullOrEmpty()) return message
        return "$fallback (${e.javaClass.simpleName})"
    }

    @Command
    fun info(invoke: Invoke) {
        val args = invoke.parseArgs(InfoArgs::class.java)
        thread {
            try {
                start()
                val info = YoutubeDL.getInstance().getInfo(args.url)
                val ret = JSObject()
                ret.put("title", info.title ?: "")
                ret.put("uploader", info.uploader)
                ret.put("duration", info.duration)
                ret.put("thumbnail", info.thumbnail)
                invoke.resolve(ret)
            } catch (e: Exception) {
                invoke.reject(describe(e, "could not read the video info"))
            }
        }
    }

    /**
     * Run yt-dlp with the arguments Rust built, streaming its output back a
     * line at a time. Resolves when the process ends; the caller's channel has
     * already seen everything needed to report progress and the final path.
     */
    @Command
    fun run(invoke: Invoke) {
        val args = invoke.parseArgs(RunArgs::class.java)
        thread {
            try {
                start()
                // Claim the engine under the lock: an update either finished
                // before this point or will see `running` and defer.
                synchronized(engineLock) { running.incrementAndGet() }
                // Ours goes in via addCommands, which lands after the library's
                // own --ffmpeg-location in the final command line — and the
                // last one is the one yt-dlp uses.
                val commands = args.args + listOf("--ffmpeg-location", ffmpegBinDir().absolutePath)
                val request = YoutubeDLRequest(emptyList()).addCommands(commands)
                val response = try {
                    YoutubeDL.getInstance().execute(
                        request,
                        args.processId,
                        true
                    ) { _, _, line ->
                        val payload = JSObject()
                        payload.put("line", line)
                        args.onLine.send(payload)
                    }
                } finally {
                    running.decrementAndGet()
                }
                // yt-dlp writes its progress to stdout; with the error stream
                // redirected into it, this also carries anything that went
                // wrong, which the Rust side logs.
                val out = JSObject()
                out.put("output", response.out)
                invoke.resolve(out)
            } catch (e: Exception) {
                invoke.reject(describe(e, "the download failed"))
            }
        }
    }

    @Command
    fun cancel(invoke: Invoke) {
        val args = invoke.parseArgs(CancelArgs::class.java)
        YoutubeDL.getInstance().destroyProcessById(args.processId)
        invoke.resolve()
    }
}
