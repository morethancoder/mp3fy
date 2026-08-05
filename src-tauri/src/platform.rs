//! The small platform errands the UI needs: whether a produced file is still
//! there, how to put it in front of the user, and how much of the screen the
//! system has already claimed.
//!
//! Each one is a one-liner on desktop and a genuinely different thing on
//! Android, which is exactly why they are collected here instead of being
//! guessed at in the frontend.

#[cfg(target_os = "android")]
use crate::android_engine::Insets;

/// On desktop the frontend uses the opener plugin directly; only Android needs
/// its own shape for this.
#[cfg(not(target_os = "android"))]
#[derive(Clone, Copy, Default, serde::Serialize)]
pub struct Insets {
    pub top: f64,
    pub bottom: f64,
    pub left: f64,
    pub right: f64,
}

/// Does this path still name a file? History rows outlive the files they
/// point at — someone empties a Downloads folder and the app should say so
/// rather than blame whatever failed next.
#[tauri::command]
pub fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

/// Open a produced file with whatever app can handle it.
///
/// Android only: the desktop build reveals the file in its file manager
/// through the opener plugin, which documents Android as unsupported — and
/// duly failed there, which the UI reported as a missing file.
#[tauri::command]
pub fn open_file(
    #[allow(unused_variables)] app: tauri::AppHandle,
    #[allow(unused_variables)] path: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        crate::android_engine::open_file(&app, &path)
    }

    #[cfg(not(target_os = "android"))]
    Err("opening a file this way is Android-only".into())
}

/// What the player is doing, as the notification needs to describe it.
///
/// Android only: every other platform gets the same surface for free, because
/// its webview publishes `navigator.mediaSession` to the OS. Android's does
/// not, so the state has to be carried across to a native session by hand —
/// see `MediaService.kt`.
#[derive(Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaState {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// A remote URL, a `data:` URI or a path — whatever the history row has.
    pub artwork: Option<String>,
    pub playing: bool,
    /// Seconds; `duration` is zero while the file is still being read.
    pub position: f64,
    pub duration: f64,
    pub shuffle: bool,
    /// `off` | `all` | `one`
    pub repeat: String,
    pub can_next: bool,
    pub can_previous: bool,
}

/// Put the current track on the phone's lock screen and notification shade,
/// or bring what is already there in line with the player.
///
/// A no-op everywhere else, and called as one: the frontend does not branch.
#[tauri::command]
pub fn show_media_notification(
    #[allow(unused_variables)] app: tauri::AppHandle,
    #[allow(unused_variables)] state: MediaState,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        crate::android_engine::media_update(&app, &state)
    }

    #[cfg(not(target_os = "android"))]
    Ok(())
}

/// Playback is over — take it down again.
#[tauri::command]
pub fn hide_media_notification(
    #[allow(unused_variables)] app: tauri::AppHandle,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        crate::android_engine::media_hide(&app)
    }

    #[cfg(not(target_os = "android"))]
    Ok(())
}

/// The insets CSS cannot see. Zero everywhere but Android, where
/// `env(safe-area-inset-*)` reports the display cutout and nothing else.
#[tauri::command]
pub fn safe_area_insets(#[allow(unused_variables)] app: tauri::AppHandle) -> Insets {
    #[cfg(target_os = "android")]
    {
        crate::android_engine::insets(&app).unwrap_or_default()
    }

    #[cfg(not(target_os = "android"))]
    Insets::default()
}
