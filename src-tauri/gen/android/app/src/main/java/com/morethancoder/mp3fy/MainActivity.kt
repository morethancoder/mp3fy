package com.morethancoder.mp3fy

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /**
   * The player lives in the webview, so when the webview goes the transport
   * buttons have nothing left to talk to. Leaving the notification up would
   * leave a working-looking player that answers nothing.
   *
   * Only when the app is actually finishing: a configuration change destroys
   * the activity too, and playback is meant to survive that.
   */
  override fun onDestroy() {
    if (isFinishing) MediaControls.hide(this)
    super.onDestroy()
  }
}
