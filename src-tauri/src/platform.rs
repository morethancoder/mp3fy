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
