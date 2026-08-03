package com.morethancoder.mp3fy

import android.app.Activity
import android.content.Intent
import android.os.Environment
import android.webkit.WebView
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

@TauriPlugin
class YtdlpPlugin(private val activity: Activity) : Plugin(activity) {
    private var started = false

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

    /** Hand over the pending shared text, once. */
    @Command
    fun sharedLink(invoke: Invoke) {
        val ret = JSObject()
        ret.put("text", sharedText)
        sharedText = null
        invoke.resolve(ret)
    }

    /** Unpacks the engine on first use; later calls are cheap. */
    private fun start() {
        if (started) return
        YoutubeDL.getInstance().init(activity.applicationContext)
        FFmpeg.getInstance().init(activity.applicationContext)
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
            ret.put("version", YoutubeDL.getInstance().version(activity.applicationContext) ?: "")
            ret.put("outputDir", outputDir().absolutePath)
            invoke.resolve(ret)
        } catch (e: Exception) {
            invoke.reject(e.message ?: "the download engine could not start")
        }
    }

    @Command
    fun update(invoke: Invoke) {
        thread {
            try {
                start()
                YoutubeDL.getInstance().updateYoutubeDL(activity.applicationContext)
                val ret = JSObject()
                ret.put(
                    "version",
                    YoutubeDL.getInstance().version(activity.applicationContext) ?: ""
                )
                invoke.resolve(ret)
            } catch (e: Exception) {
                invoke.reject(e.message ?: "the update failed")
            }
        }
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
                invoke.reject(e.message ?: "could not read the video info")
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
                val request = YoutubeDLRequest(emptyList()).addCommands(args.args)
                val response = YoutubeDL.getInstance().execute(
                    request,
                    args.processId,
                    true
                ) { _, _, line ->
                    val payload = JSObject()
                    payload.put("line", line)
                    args.onLine.send(payload)
                }
                // yt-dlp writes its progress to stdout; with the error stream
                // redirected into it, this also carries anything that went
                // wrong, which the Rust side logs.
                val out = JSObject()
                out.put("output", response.out)
                invoke.resolve(out)
            } catch (e: Exception) {
                invoke.reject(e.message ?: "the download failed")
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
