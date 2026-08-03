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

#[derive(Deserialize)]
pub struct Version {
    pub version: String,
}

pub fn update(app: &AppHandle) -> Result<String, String> {
    let res: Version = plugin(app)?
        .0
        .run_mobile_plugin("update", ())
        .map_err(|e| e.to_string())?;
    Ok(res.version)
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
