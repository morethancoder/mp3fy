package com.morethancoder.mp3fy

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.media.app.NotificationCompat as MediaNotification
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * The player mp3fy shows the rest of Android.
 *
 * The audio itself never comes near this class — it plays in the webview, out
 * of an `<audio>` element that survives navigation ($lib/player). What is
 * missing there is everything outside the app: **Android's WebView implements
 * the Web `MediaSession` API but publishes nothing to the system**, so on a
 * phone the API bought us exactly nothing. No notification, no lock-screen
 * controls, no headset buttons. Chrome shows those because the browser wraps
 * the page's session in a native one; a WebView has no browser around it.
 *
 * So this is that wrapper. A [MediaSessionCompat] carries the metadata and
 * transport state Android's media surfaces read, a MediaStyle notification
 * carries the buttons, and every press goes back to the webview to be acted on
 * there — the frontend stays the only thing that knows what "next" means.
 *
 * It is a foreground service for the ordinary reason: a backgrounded app is a
 * candidate for being killed, and being killed mid-track is what a music app
 * may not do.
 */
class MediaService : Service() {
    private companion object {
        const val CHANNEL = "playback"
        const val NOTIFICATION = 1

        /** Prefixes the intent action each notification button sends back. */
        const val ACTION = "com.morethancoder.mp3fy.media."

        /** Album art beyond this is scaled down; the largest surface is ~a third of it. */
        const val ARTWORK_PX = 512

        /**
         * How long a pause has to last before the notification is let go of.
         *
         * Long enough that the gap between two tracks is never mistaken for
         * one: a track ending pauses the element for as long as it takes to
         * read the next file, and demoting in that gap is unrecoverable —
         * Android will not let a background service go foreground again on its
         * own, so the queue plays on with the process killable underneath it.
         * (Measured: `Background started FGS: Disallowed … code:DENIED`.) A
         * resume the *user* asked for is exempt either way, which is why this
         * only has to outlast the automatic kind.
         */
        const val DEMOTE_AFTER_MS = 10_000L
    }

    private lateinit var session: MediaSessionCompat
    private val main = Handler(Looper.getMainLooper())

    /** Whether the notification is currently the service's foreground one. */
    private var foreground = false

    /** The artwork we have, and what it was loaded from — see [artworkFor]. */
    private var artworkKey: String? = null
    private var artwork: Bitmap? = null

    /**
     * Hands the notification over to the user once a pause has lasted, so that
     * it can be swiped away like any other. Before Android 14 an ongoing
     * foreground notification cannot be dismissed at all, and a player nobody
     * is listening to should not be permanent.
     */
    private val demote = Runnable {
        if (!foreground) return@Runnable
        if (MediaControls.state?.playing != false) return@Runnable
        stopForeground(Service.STOP_FOREGROUND_DETACH)
        foreground = false
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        session = MediaSessionCompat(this, "mp3fy")
        session.setCallback(object : MediaSessionCompat.Callback() {
            override fun onPlay() = MediaControls.dispatch("play")
            override fun onPause() = MediaControls.dispatch("pause")
            override fun onSkipToNext() = MediaControls.dispatch("next")
            override fun onSkipToPrevious() = MediaControls.dispatch("previous")
            override fun onStop() = MediaControls.dispatch("stop")
            override fun onSeekTo(pos: Long) = MediaControls.dispatch("seek", pos / 1000.0)

            // Shuffle and repeat are on the session as well as on the
            // notification, because which of the two a media surface reads is
            // its own business — the shade takes the notification's actions,
            // Android Auto and the lock screen take the session's.
            override fun onCustomAction(action: String?, extras: Bundle?) {
                if (action != null) MediaControls.dispatch(action)
            }

            override fun onSetShuffleMode(shuffleMode: Int) = MediaControls.dispatch("shuffle")
            override fun onSetRepeatMode(repeatMode: Int) = MediaControls.dispatch("repeat")
        })
        session.isActive = true
        MediaControls.service = this
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        if (action != null && action.startsWith(ACTION)) {
            MediaControls.dispatch(action.removePrefix(ACTION))
        }
        // Whatever started us, the contract is the same: a service started with
        // startForegroundService has about five seconds to show a notification.
        refresh()
        return START_NOT_STICKY
    }

    /**
     * The app was swiped out of recents. The webview went with it, so the
     * transport buttons now point at a player that no longer exists — take the
     * notification down rather than leave a dead one on the shade.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        main.removeCallbacks(demote)
        MediaControls.service = null
        session.isActive = false
        session.release()
        stopForeground(Service.STOP_FOREGROUND_REMOVE)
        // Once detached the notification is nobody's, and STOP_FOREGROUND_REMOVE
        // no longer reaches it — a service the system reclaims while paused
        // ("Stopping service due to app idle", a few minutes after the last
        // track) would leave a player behind whose buttons control nothing.
        getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION)
        foreground = false
        super.onDestroy()
    }

    /** Publish the frontend's latest picture of the player. Main thread only. */
    fun refresh() {
        val state = MediaControls.state
        if (state == null) {
            stopSelf()
            return
        }
        main.removeCallbacks(demote)

        session.setMetadata(metadata(state))
        session.setPlaybackState(playback(state))
        session.setShuffleMode(
            if (state.shuffle) PlaybackStateCompat.SHUFFLE_MODE_ALL
            else PlaybackStateCompat.SHUFFLE_MODE_NONE
        )
        session.setRepeatMode(
            when (state.repeat) {
                "one" -> PlaybackStateCompat.REPEAT_MODE_ONE
                "all" -> PlaybackStateCompat.REPEAT_MODE_ALL
                else -> PlaybackStateCompat.REPEAT_MODE_NONE
            }
        )

        val notification = notification(state)
        try {
            startForeground(NOTIFICATION, notification)
            foreground = true
        } catch (e: Exception) {
            // Android 12+ refuses a foreground start from the background, and
            // this can be reached from there (a track ending in a pocket). The
            // notification is worth more than the promotion, so post it anyway
            // and accept that the process is killable until the next resume.
            android.util.Log.w("mp3fy", "[player] could not go foreground: ${e.message}")
            foreground = false
            try {
                getSystemService(NotificationManager::class.java)?.notify(NOTIFICATION, notification)
            } catch (refused: Exception) {
                android.util.Log.w(
                    "mp3fy",
                    "[player] could not post the notification: ${refused.message}"
                )
            }
        }

        // Paused, the notification eventually stops being the service's and
        // becomes an ordinary one the user can swipe away (which fires the stop
        // action). Eventually, not immediately: see DEMOTE_AFTER_MS.
        if (!state.playing) main.postDelayed(demote, DEMOTE_AFTER_MS)
    }

    private fun metadata(state: MediaArgs): MediaMetadataCompat {
        val art = artworkFor(state.artwork)
        return MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, state.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, state.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, state.album)
            // -1 is "unknown", which is the honest answer while a file is still
            // being read; a real one is what puts a scrubber on the shade.
            .putLong(
                MediaMetadataCompat.METADATA_KEY_DURATION,
                if (state.duration > 0) (state.duration * 1000).toLong() else -1L
            )
            .apply { if (art != null) putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art) }
            .build()
    }

    private fun playback(state: MediaArgs): PlaybackStateCompat {
        var actions = PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_STOP or
            PlaybackStateCompat.ACTION_SEEK_TO or
            PlaybackStateCompat.ACTION_SET_SHUFFLE_MODE or
            PlaybackStateCompat.ACTION_SET_REPEAT_MODE
        if (state.canNext) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_NEXT
        if (state.canPrevious) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS

        return PlaybackStateCompat.Builder()
            .setActions(actions)
            .addCustomAction(
                PlaybackStateCompat.CustomAction
                    .Builder("shuffle", getString(R.string.media_shuffle), shuffleIcon(state))
                    .build()
            )
            .addCustomAction(
                PlaybackStateCompat.CustomAction
                    .Builder("repeat", getString(R.string.media_repeat), repeatIcon(state))
                    .build()
            )
            .setState(
                if (state.playing) PlaybackStateCompat.STATE_PLAYING
                else PlaybackStateCompat.STATE_PAUSED,
                (state.position * 1000).toLong(),
                // Paused means the position stands still: at 1x the system
                // extrapolates from the last update and the scrubber runs on
                // its own after playback has stopped.
                if (state.playing) 1f else 0f
            )
            .build()
    }

    private fun notification(state: MediaArgs): Notification {
        channel()
        val builder = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(state.title)
            .setContentText(state.artist)
            .setLargeIcon(artwork)
            // Tapping anywhere that is not a button opens the app, on the
            // task that is already running rather than a second copy of it.
            .setContentIntent(openApp())
            .setDeleteIntent(action("stop"))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setOngoing(state.playing)

        // Five actions is what MediaStyle shows expanded; the middle three are
        // what the collapsed notification has room for.
        builder.addAction(shuffleIcon(state), getString(R.string.media_shuffle), action("shuffle"))
        builder.addAction(
            R.drawable.ic_media_previous,
            getString(R.string.media_previous),
            action("previous")
        )
        builder.addAction(
            if (state.playing) R.drawable.ic_media_pause else R.drawable.ic_media_play,
            getString(if (state.playing) R.string.media_pause else R.string.media_play),
            action(if (state.playing) "pause" else "play")
        )
        builder.addAction(R.drawable.ic_media_next, getString(R.string.media_next), action("next"))
        builder.addAction(repeatIcon(state), getString(R.string.media_repeat), action("repeat"))

        builder.setStyle(
            MediaNotification.MediaStyle()
                .setMediaSession(session.sessionToken)
                .setShowActionsInCompactView(1, 2, 3)
                .setShowCancelButton(true)
                .setCancelButtonIntent(action("stop"))
        )
        return builder.build()
    }

    private fun shuffleIcon(state: MediaArgs) =
        if (state.shuffle) R.drawable.ic_media_shuffle_on else R.drawable.ic_media_shuffle

    private fun repeatIcon(state: MediaArgs) = when (state.repeat) {
        "one" -> R.drawable.ic_media_repeat_one
        "all" -> R.drawable.ic_media_repeat_on
        // "Stop after this track" has no PlaybackStateCompat repeat mode to
        // borrow — the session is told NONE, which is true of the looping —
        // so the icon is the only place the notification can show it.
        "stop" -> R.drawable.ic_media_repeat_stop
        else -> R.drawable.ic_media_repeat
    }

    private fun channel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(
                CHANNEL,
                getString(R.string.media_channel),
                // A transport bar is not an announcement: no sound, no badge,
                // and nothing that interrupts what the phone was doing.
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.media_channel_description)
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            }
        )
    }

    private fun openApp(): PendingIntent {
        val intent = Intent(this, MainActivity::class.java)
            // The launcher intent specifically: MainActivity is singleTask, so
            // this brings the running app forward. An ACTION_VIEW or
            // ACTION_SEND intent would arrive at the plugin looking like a
            // shared link and start a download.
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /**
     * A button, as an intent back into this service. The request code varies
     * with the name so play and pause — the same button, two states — keep
     * separate pending intents instead of overwriting each other.
     */
    private fun action(name: String): PendingIntent {
        val intent = Intent(this, MediaService::class.java).setAction(ACTION + name)
        return PendingIntent.getService(
            this,
            name.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    /**
     * The cover, once. Loading it takes a network round trip for a thumbnail
     * yt-dlp gave us as a URL, so the first call starts that in the background
     * and answers null; when it lands, the notification is rebuilt with it.
     *
     * The key is the source, not the bitmap, so a cover that fails to load is
     * not retried on every position update — and the same cover across a pause
     * and a resume is not re-fetched.
     */
    private fun artworkFor(source: String?): Bitmap? {
        if (source.isNullOrEmpty()) {
            artworkKey = null
            artwork = null
            return null
        }
        if (source == artworkKey) return artwork

        artworkKey = source
        artwork = null
        thread {
            val loaded = loadArtwork(source)
            main.post {
                if (artworkKey != source) return@post // another track won
                artwork = loaded
                if (loaded != null) refresh()
            }
        }
        return null
    }

    private fun loadArtwork(source: String): Bitmap? {
        return try {
            val bytes = when {
                source.startsWith("data:") ->
                    Base64.decode(source.substringAfter(','), Base64.DEFAULT)

                source.startsWith("http") ->
                    (URL(source).openConnection() as HttpURLConnection).run {
                        connectTimeout = 10_000
                        readTimeout = 10_000
                        instanceFollowRedirects = true
                        inputStream.use { it.readBytes() }
                    }

                else -> File(source.removePrefix("file://")).readBytes()
            }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / sample > ARTWORK_PX) sample *= 2
            BitmapFactory.decodeByteArray(
                bytes,
                0,
                bytes.size,
                BitmapFactory.Options().apply { inSampleSize = sample }
            )
        } catch (e: Exception) {
            android.util.Log.w("mp3fy", "[player] could not load the cover: ${e.message}")
            null
        }
    }
}
