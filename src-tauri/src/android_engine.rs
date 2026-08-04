//! The Android half of the download engine.
//!
//! Desktop mp3fy downloads a yt-dlp binary into its app-data folder and runs
//! it. Android does not allow executing anything from an app's writable
//! storage, so there yt-dlp ships inside the APK (with its Python runtime and
//! ffmpeg) and is started by `YtdlpPlugin.kt`.
//!
//! This module is the thin Rust side of that bridge. It deliberately does not
//! know what a download *is*: arguments are built by `download.rs` exactly as
//! they are for desktop, and yt-dlp's output comes back line by line over a
//! channel to the same parser. Only the way the process is started differs.

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::plugin::{Builder, PluginHandle, TauriPlugin};
use tauri::{AppHandle, Manager, Wry};

pub struct Engine(PluginHandle<Wry>);

pub fn init() -> TauriPlugin<Wry> {
    Builder::new("mp3fy-engine")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.morethancoder.mp3fy", "YtdlpPlugin")?;
            app.manage(Engine(handle));
            Ok(())
        })
        .build()
}

fn plugin(app: &AppHandle) -> Result<tauri::State<'_, Engine>, String> {
    app.try_state::<Engine>()
        .ok_or_else(|| "the download engine is not available".to_string())
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    pub version: String,
    /// Where finished files are written — decided by Android, not by us.
    pub output_dir: String,
}

/// Unpack the engine (idempotent) and learn where it writes.
pub fn setup(app: &AppHandle) -> Result<Setup, String> {
    plugin(app)?
        .0
        .run_mobile_plugin("setup", ())
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallArgs {
    path: String,
    version: String,
}

#[derive(Deserialize)]
pub struct Installed {
    pub version: String,
    /// False when a download held the engine and the swap was skipped.
    pub installed: bool,
}

/// Hand a downloaded yt-dlp to the engine, replacing the one in use.
pub fn install(app: &AppHandle, path: &str, version: &str) -> Result<Installed, String> {
    plugin(app)?
        .0
        .run_mobile_plugin(
            "install",
            InstallArgs {
                path: path.into(),
                version: version.into(),
            },
        )
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub version: String,
    /// True once an update replaced the copy that shipped in the APK.
    pub updated: bool,
    pub ffmpeg: bool,
    pub ffprobe: bool,
}

/// What the engine is made of right now. Costs a yt-dlp start on a fresh
/// install (nothing else knows the bundled version), so it is only ever
/// called by the tools screen.
pub fn status(app: &AppHandle) -> Result<Status, String> {
    plugin(app)?
        .0
        .run_mobile_plugin("status", ())
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct InfoArgs {
    url: String,
}

#[derive(Deserialize)]
pub struct Info {
    pub title: Option<String>,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
}

pub fn info(app: &AppHandle, url: &str) -> Result<Info, String> {
    plugin(app)?
        .0
        .run_mobile_plugin("info", InfoArgs { url: url.into() })
        .map_err(|e| e.to_string())
}

/// One yt-dlp process at a time, same as desktop — this names it so `cancel`
/// can find it.
const PROCESS_ID: &str = "mp3fy";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RunArgs {
    args: Vec<String>,
    on_line: Channel<serde_json::Value>,
    process_id: String,
}

#[derive(Deserialize)]
struct LineMessage {
    line: String,
}

/// Run yt-dlp and block until it finishes, handing every output line to
/// `on_line`. Errors carry yt-dlp's own message.
pub fn run<F>(app: &AppHandle, args: Vec<String>, on_line: F) -> Result<(), String>
where
    F: Fn(String) + Send + Sync + 'static,
{
    let on_line = Channel::new(move |body| {
        if let InvokeResponseBody::Json(json) = body {
            if let Ok(msg) = serde_json::from_str::<LineMessage>(&json) {
                on_line(msg.line);
            }
        }
        Ok(())
    });

    plugin(app)?
        .0
        .run_mobile_plugin::<serde_json::Value>(
            "run",
            RunArgs {
                args,
                on_line,
                process_id: PROCESS_ID.into(),
            },
        )
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// How much of the screen the system bars and the display cutout take, in CSS
/// pixels. See `YtdlpPlugin.insets` for why CSS cannot ask this itself.
#[derive(Clone, Copy, Default, Deserialize, Serialize)]
pub struct Insets {
    pub top: f64,
    pub bottom: f64,
    pub left: f64,
    pub right: f64,
}

pub fn insets(app: &AppHandle) -> Result<Insets, String> {
    plugin(app)?
        .0
        .run_mobile_plugin("insets", ())
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct OpenArgs {
    path: String,
}

/// Hand a finished file to another app — Android's answer to revealing it in
/// a file manager, which the opener plugin does not support here.
pub fn open_file(app: &AppHandle, path: &str) -> Result<(), String> {
    plugin(app)?
        .0
        .run_mobile_plugin::<serde_json::Value>("openFile", OpenArgs { path: path.into() })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[derive(Deserialize)]
struct SharedLink {
    text: Option<String>,
}

/// The link the system share sheet handed us, if one is waiting. Reading it
/// clears it, so the same share never starts two downloads.
pub fn shared_link(app: &AppHandle) -> Option<String> {
    let res: SharedLink = plugin(app)
        .ok()?
        .0
        .run_mobile_plugin("sharedLink", ())
        .ok()?;
    res.text
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CancelArgs {
    process_id: String,
}

pub fn cancel(app: &AppHandle) {
    if let Ok(engine) = plugin(app) {
        let _ = engine.0.run_mobile_plugin::<serde_json::Value>(
            "cancel",
            CancelArgs {
                process_id: PROCESS_ID.into(),
            },
        );
    }
}
