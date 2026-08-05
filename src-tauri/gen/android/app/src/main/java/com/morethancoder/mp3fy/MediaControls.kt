package com.morethancoder.mp3fy

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import app.tauri.annotation.InvokeArg

/**
 * What the player looks like right now, as the frontend describes it.
 *
 * Everything the notification shows or offers is in here: nothing on the
 * Android side reads the audio, decides what plays next, or remembers a
 * playlist. The `<audio>` element in the webview is still the only player —
 * this is a picture of it, pushed over whenever that picture changes.
 */
@InvokeArg
class MediaArgs {
    var title: String = ""
    var artist: String = ""
    var album: String = ""

    /** A remote URL, a `data:` URI or a plain path — whatever history carries. */
    var artwork: String? = null

    var playing: Boolean = false

    /** Seconds, both of them; `duration` is 0 while a file is still loading. */
    var position: Double = 0.0
    var duration: Double = 0.0

    var shuffle: Boolean = false

    /** `off` | `all` | `one` */
    var repeat: String = "off"

    var canNext: Boolean = true
    var canPrevious: Boolean = true
}

/**
 * The one place the plugin, the service and the notification meet.
 *
 * They all live in the same process, so a plain object is the whole bridge:
 * the plugin writes [state] and asks the service to catch up, the service
 * reads it, and every button the user presses comes back through [dispatch] to
 * the channel the plugin is holding. Nothing is passed through Intent extras,
 * which keeps the state a single object rather than something reassembled from
 * a bundle on the far side.
 */
object MediaControls {
    private val main = Handler(Looper.getMainLooper())

    /** The latest picture of the player, or null once playback is over. */
    @Volatile
    var state: MediaArgs? = null
        private set

    /** Set by the running service so an update need not go through an Intent. */
    @Volatile
    var service: MediaService? = null

    /** Where a pressed button goes: the plugin's channel back to the frontend. */
    @Volatile
    var onAction: ((String, Double?) -> Unit)? = null

    /**
     * Show or refresh the notification.
     *
     * The service is started on the first update and then kept, because
     * starting a foreground service is only allowed while the app is in the
     * foreground — which the first update always is (playback begins with a
     * tap in the app), and later ones may not be (a track ending advances the
     * queue with the phone in a pocket).
     */
    fun update(context: Context, next: MediaArgs) {
        state = next
        main.post {
            val running = service
            if (running != null) {
                running.refresh()
            } else {
                ContextCompat.startForegroundService(
                    context.applicationContext,
                    Intent(context.applicationContext, MediaService::class.java)
                )
            }
        }
    }

    /** Playback is over: the session goes away and the notification with it. */
    fun hide(context: Context) {
        state = null
        main.post {
            context.applicationContext.stopService(
                Intent(context.applicationContext, MediaService::class.java)
            )
        }
    }

    /** A transport button, from the notification, the lock screen or a headset. */
    fun dispatch(action: String, position: Double? = null) {
        val sink = onAction
        if (sink == null) {
            android.util.Log.w("mp3fy", "[player] nothing is listening for $action")
            return
        }
        sink(action, position)
    }
}
