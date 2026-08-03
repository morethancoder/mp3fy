//! yt-dlp + ffmpeg management: first-run download into the app data dir,
//! self-update, and metadata probing. Everything runs on the user's device
//! with the user's own IP — no server in the middle.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use tauri::Manager;

use crate::logs::log;

/// Checked-once-per-session cache. First call verifies (or installs) the
/// binaries; every later download starts instantly instead of re-probing.
#[derive(Clone)]
struct ToolsCache {
    ytdlp_version: String,
    ffmpeg: bool,
}

static CACHE: Mutex<Option<ToolsCache>> = Mutex::new(None);

pub fn bin_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bin");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

pub fn ytdlp_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(bin_dir(app)?.join(exe("yt-dlp")))
}

/// Platform-matching asset name in yt-dlp's GitHub releases.
fn ytdlp_asset() -> &'static str {
    if cfg!(target_os = "macos") {
        "yt-dlp_macos"
    } else if cfg!(target_os = "windows") {
        "yt-dlp.exe"
    } else if cfg!(target_arch = "aarch64") {
        "yt-dlp_linux_aarch64"
    } else {
        "yt-dlp_linux"
    }
}

/// Build a Command that never flashes a console window on Windows.
pub fn quiet_command(program: &Path) -> Command {
    let cmd = Command::new(program);
    #[cfg(windows)]
    let cmd = {
        use std::os::windows::process::CommandExt;
        let mut cmd = cmd;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        cmd
    };
    cmd
}

#[cfg(unix)]
fn make_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
        .map_err(|e| e.to_string())
}

#[cfg(not(unix))]
fn make_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

async fn download_file(url: &str, dest: &Path) -> Result<(), String> {
    let resp = reqwest::get(url)
        .await
        .map_err(|e| format!("download failed: {e}"))?
        .error_for_status()
        .map_err(|e| format!("download failed: {e}"))?;
    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(dest, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}

fn binary_version(path: &Path) -> Option<String> {
    let out = quiet_command(path).arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

async fn ensure_ytdlp(app: &tauri::AppHandle) -> Result<String, String> {
    if let Some(cache) = CACHE.lock().unwrap().as_ref() {
        return Ok(cache.ytdlp_version.clone());
    }
    let path = ytdlp_path(app)?;
    if let Some(v) = binary_version(&path) {
        return Ok(v);
    }
    let url = format!(
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/{}",
        ytdlp_asset()
    );
    log("tools", format!("downloading yt-dlp from {url}"));
    download_file(&url, &path).await?;
    make_executable(&path)?;
    let version = binary_version(&path)
        .ok_or_else(|| "yt-dlp was downloaded but does not run".to_string())?;
    log("tools", format!("yt-dlp {version} installed"));
    Ok(version)
}

/// Where ffmpeg lives if we manage it ourselves (next to yt-dlp).
pub fn managed_ffmpeg(app: &tauri::AppHandle) -> Option<PathBuf> {
    let path = bin_dir(app).ok()?.join(exe("ffmpeg"));
    path.exists().then_some(path)
}

fn system_ffmpeg() -> bool {
    quiet_command(Path::new("ffmpeg"))
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn ffmpeg_available(app: &tauri::AppHandle) -> bool {
    managed_ffmpeg(app).is_some() || system_ffmpeg()
}

/// The ffmpeg to invoke: our managed copy if present, else whatever is on
/// the PATH.
pub fn ffmpeg_program(app: &tauri::AppHandle) -> PathBuf {
    managed_ffmpeg(app).unwrap_or_else(|| PathBuf::from("ffmpeg"))
}

/// All app output lands in one folder the user can find: Downloads/mp3fy on
/// desktop, and on Android wherever the engine is allowed to write.
pub fn downloads_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    #[cfg(target_os = "android")]
    {
        return Ok(PathBuf::from(crate::android_engine::setup(app)?.output_dir));
    }

    #[cfg(not(target_os = "android"))]
    {
    use tauri::Manager as _;
    let base = app
        .path()
        .download_dir()
        .or_else(|_| app.path().home_dir())
        .map_err(|e| e.to_string())?;
    let dir = base.join("mp3fy");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
    }
}

#[tauri::command]
pub fn downloads_folder(app: tauri::AppHandle) -> Result<String, String> {
    Ok(downloads_dir(&app)?.to_string_lossy().into_owned())
}

fn find_file(dir: &Path, name: &str) -> Option<PathBuf> {
    for entry in std::fs::read_dir(dir).ok()? {
        let path = entry.ok()?.path();
        if path.is_dir() {
            if let Some(found) = find_file(&path, name) {
                return Some(found);
            }
        } else if path.file_name().is_some_and(|n| n == name) {
            return Some(path);
        }
    }
    None
}

/// Fetch a static ffmpeg (and ffprobe) into the bin dir when the system has
/// none. macOS builds come from evermeet.cx, the rest from yt-dlp's own
/// FFmpeg-Builds releases.
pub async fn ensure_ffmpeg(app: &tauri::AppHandle) -> Result<(), String> {
    // Android ships ffmpeg inside the APK, next to yt-dlp's Python runtime —
    // there is nothing to fetch, and nowhere to put it if there were.
    #[cfg(target_os = "android")]
    {
        let _ = app;
        Ok(())
    }

    #[cfg(not(target_os = "android"))]
    ensure_ffmpeg_desktop(app).await
}

#[cfg(not(target_os = "android"))]
async fn ensure_ffmpeg_desktop(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(cache) = CACHE.lock().unwrap().as_ref() {
        if cache.ffmpeg {
            return Ok(());
        }
    }
    if ffmpeg_available(app) {
        if let Some(cache) = CACHE.lock().unwrap().as_mut() {
            cache.ffmpeg = true;
        }
        return Ok(());
    }
    log("tools", "no ffmpeg found — fetching a static build");
    let bin = bin_dir(app)?;
    let scratch = bin.join("ffmpeg-download");
    std::fs::create_dir_all(&scratch).map_err(|e| e.to_string())?;

    let archives: Vec<(String, &str)> = if cfg!(target_os = "macos") {
        vec![
            ("https://evermeet.cx/ffmpeg/getrelease/zip".into(), "ffmpeg"),
            (
                "https://evermeet.cx/ffmpeg/getrelease/ffprobe/zip".into(),
                "ffprobe",
            ),
        ]
    } else {
        let asset = if cfg!(target_os = "windows") {
            "ffmpeg-master-latest-win64-gpl.zip"
        } else if cfg!(target_arch = "aarch64") {
            "ffmpeg-master-latest-linuxarm64-gpl.tar.xz"
        } else {
            "ffmpeg-master-latest-linux64-gpl.tar.xz"
        };
        vec![(
            format!(
                "https://github.com/yt-dlp/FFmpeg-Builds/releases/latest/download/{asset}"
            ),
            "ffmpeg",
        )]
    };

    for (url, _) in &archives {
        let archive = scratch.join(url.rsplit('/').next().unwrap_or("archive"));
        download_file(url, &archive).await?;
        // bsdtar on macOS/Windows and GNU tar on Linux all handle these.
        let status = Command::new("tar")
            .arg("-xf")
            .arg(&archive)
            .arg("-C")
            .arg(&scratch)
            .status()
            .map_err(|e| format!("could not extract ffmpeg: {e}"))?;
        if !status.success() {
            return Err("could not extract the ffmpeg archive".into());
        }
    }

    for name in ["ffmpeg", "ffprobe"] {
        let wanted = exe(name);
        if let Some(found) = find_file(&scratch, &wanted) {
            let dest = bin.join(&wanted);
            std::fs::copy(&found, &dest).map_err(|e| e.to_string())?;
            make_executable(&dest)?;
        }
    }
    let _ = std::fs::remove_dir_all(&scratch);

    if managed_ffmpeg(app).is_some() {
        if let Some(cache) = CACHE.lock().unwrap().as_mut() {
            cache.ffmpeg = true;
        }
        log("tools", "ffmpeg installed");
        Ok(())
    } else {
        log("tools", "ffmpeg install failed");
        Err("ffmpeg could not be installed automatically".into())
    }
}

#[derive(serde::Serialize)]
pub struct ToolsStatus {
    pub ytdlp_version: Option<String>,
    pub ffmpeg_available: bool,
}

#[tauri::command]
pub async fn ensure_tools(app: tauri::AppHandle) -> Result<ToolsStatus, String> {
    if let Some(cache) = CACHE.lock().unwrap().as_ref() {
        return Ok(ToolsStatus {
            ytdlp_version: Some(cache.ytdlp_version.clone()),
            ffmpeg_available: cache.ffmpeg,
        });
    }

    // On Android "ensure" means unpack what the APK already carries: the
    // first call costs a moment, and there is never a download.
    #[cfg(target_os = "android")]
    let (version, ffmpeg) = (crate::android_engine::setup(&app)?.version, true);

    #[cfg(not(target_os = "android"))]
    let (version, ffmpeg) = (ensure_ytdlp(&app).await?, ffmpeg_available(&app));
    *CACHE.lock().unwrap() = Some(ToolsCache {
        ytdlp_version: version.clone(),
        ffmpeg,
    });
    log("tools", format!("ready: yt-dlp {version}, ffmpeg {ffmpeg}"));
    Ok(ToolsStatus {
        ytdlp_version: Some(version),
        ffmpeg_available: ffmpeg,
    })
}

#[tauri::command]
pub async fn update_ytdlp(app: tauri::AppHandle) -> Result<String, String> {
    // Android's yt-dlp updates itself in place through the engine — the copy
    // in the APK is only ever the starting point.
    #[cfg(target_os = "android")]
    {
        let version = crate::android_engine::update(&app)?;
        if let Some(cache) = CACHE.lock().unwrap().as_mut() {
            cache.ytdlp_version = version.clone();
        }
        log("tools", format!("yt-dlp update check done: {version}"));
        return Ok(version);
    }

    #[cfg(not(target_os = "android"))]
    {
    ensure_ytdlp(&app).await?;
    let path = ytdlp_path(&app)?;
    let out = quiet_command(&path)
        .arg("-U")
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        log("tools", format!("yt-dlp update failed: {err}"));
        return Err(err);
    }
    let version = binary_version(&path)
        .ok_or_else(|| "yt-dlp stopped working after the update".to_string())?;
    if let Some(cache) = CACHE.lock().unwrap().as_mut() {
        cache.ytdlp_version = version.clone();
    }
    log("tools", format!("yt-dlp update check done: {version}"));
    Ok(version)
    }
}

#[derive(serde::Serialize)]
pub struct VideoInfo {
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
}

#[tauri::command]
pub async fn fetch_info(app: tauri::AppHandle, url: String) -> Result<VideoInfo, String> {
    #[cfg(target_os = "android")]
    {
        let info = crate::android_engine::info(&app, &url)?;
        return Ok(VideoInfo {
            title: info.title.unwrap_or_else(|| "Unknown".into()),
            uploader: info.uploader,
            // The engine reports 0 for streams with no known length; the UI
            // wants "unknown", not "zero seconds".
            duration: info.duration.filter(|d| *d > 0.0),
            thumbnail: info.thumbnail,
        });
    }

    #[cfg(not(target_os = "android"))]
    {
    ensure_ytdlp(&app).await?;
    let path = ytdlp_path(&app)?;
    let out = quiet_command(&path)
        .args(["-J", "--no-playlist", "--no-warnings"])
        .arg(&url)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    let json: serde_json::Value =
        serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    Ok(VideoInfo {
        title: json["title"].as_str().unwrap_or("Unknown").to_string(),
        uploader: json["uploader"].as_str().map(String::from),
        duration: json["duration"].as_f64(),
        thumbnail: json["thumbnail"].as_str().map(String::from),
    })
    }
}
