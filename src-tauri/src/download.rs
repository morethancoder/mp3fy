//! The download pipeline: spawn yt-dlp, stream its progress lines to the
//! frontend as events, and hand back the final media file path.
//!
//! Stages emitted: `fetching` (metadata), `downloading` (with percent, size,
//! speed and ETA parsed from yt-dlp's own progress line), `converting`
//! (ffmpeg post-processing / remuxing). The frontend owns the wording — we
//! only send structure, so the UI can localise it.

#[cfg(not(target_os = "android"))]
use std::io::{BufRead, BufReader};
#[cfg(not(target_os = "android"))]
use std::process::Stdio;
use std::process::Child;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};
// Only the desktop path reaches back into app state to reap the child.
#[cfg(not(target_os = "android"))]
use tauri::Manager;

use crate::logs::log;
use crate::tools;

#[derive(Default)]
pub struct ActiveDownload(pub Mutex<Option<Child>>);

#[derive(Clone, Default, serde::Serialize)]
pub struct Progress {
    pub stage: String,
    pub percent: Option<f64>,
    pub size: Option<String>,
    pub speed: Option<String>,
    pub eta: Option<String>,
}

#[derive(Clone, serde::Serialize)]
pub struct Finished {
    pub path: String,
    pub size: Option<u64>,
}

pub fn emit_progress(app: &AppHandle, event: &str, progress: Progress) {
    let _ = app.emit(event, progress);
}

pub fn emit_done(app: &AppHandle, event: &str, path: String) {
    let size = std::fs::metadata(&path).ok().map(|m| m.len());
    let _ = app.emit(event, Finished { path, size });
}

/// Parse "[download]  45.2% of ~  10.55MiB at    2.35MiB/s ETA 00:05".
fn parse_download_line(line: &str) -> Progress {
    let mut p = Progress {
        stage: "downloading".into(),
        ..Default::default()
    };
    let tokens: Vec<&str> = line.split_whitespace().collect();
    for (i, t) in tokens.iter().enumerate() {
        if let Some(num) = t.strip_suffix('%') {
            p.percent = num.parse().ok();
        } else if *t == "of" {
            p.size = tokens
                .get(i + 1)
                .map(|s| s.trim_start_matches('~').to_string())
                .filter(|s| !s.is_empty());
        } else if *t == "at" {
            p.speed = tokens
                .get(i + 1)
                .map(|s| s.to_string())
                .filter(|s| s != "Unknown");
        } else if *t == "ETA" {
            p.eta = tokens
                .get(i + 1)
                .map(|s| s.to_string())
                .filter(|s| s != "Unknown");
        }
    }
    p
}

/// Final-path candidates yt-dlp prints along the way; the last one wins.
fn parse_destination(line: &str) -> Option<String> {
    if let Some(rest) = line.split("Destination: ").nth(1) {
        return Some(rest.trim().to_string());
    }
    if let Some(rest) = line.strip_prefix("[Merger] Merging formats into \"") {
        return Some(rest.trim_end_matches('"').to_string());
    }
    if let Some(rest) = line.split(" has already been downloaded").next() {
        if let Some(path) = rest.strip_prefix("[download] ") {
            if !path.contains("Destination") {
                return Some(path.trim().to_string());
            }
        }
    }
    None
}

/// What to tell yt-dlp, minus the URL — identical on every platform, which is
/// what lets Android hand the very same list to its bundled copy.
fn job_args(dest: &std::path::Path, format: &str, quality: &str, kind: &str) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    if kind == "video" {
        args.extend(["-f", "bv*+ba/b", "--remux-video", format].map(String::from));
    } else {
        args.extend(["-x", "--audio-format", format].map(String::from));
        args.push("--audio-quality".into());
        args.push(match quality {
            "best" => "0".to_string(),
            q => format!("{q}K"),
        });
    }
    args.extend(["--newline", "--no-playlist", "--no-mtime"].map(String::from));
    args.push("-o".into());
    args.push(dest.join("%(title)s.%(ext)s").to_string_lossy().into_owned());
    args
}

/// Everything one line of yt-dlp output can tell us, carried between lines.
#[derive(Default)]
struct Reading {
    final_path: Option<String>,
    fetching_announced: bool,
    /// yt-dlp's own last complaint, for when the engine's failure is mute.
    last_error: Option<String>,
}

/// Turn one output line into the events the UI listens for. Shared by the
/// desktop process reader and the Android engine's line channel.
fn read_line(app: &AppHandle, line: &str, state: &mut Reading) {
    if let Some(path) = parse_destination(line) {
        state.final_path = Some(path);
    }
    if line.starts_with("ERROR") {
        state.last_error = Some(line.trim().to_string());
    }
    if line.starts_with("[download]") {
        if line.contains('%') {
            emit_progress(app, "download:progress", parse_download_line(line));
        }
    } else if line.starts_with("[ExtractAudio]")
        || line.starts_with("[Merger]")
        || line.starts_with("[VideoRemuxer]")
    {
        emit_progress(
            app,
            "download:progress",
            Progress {
                stage: "converting".into(),
                ..Default::default()
            },
        );
    } else if !state.fetching_announced && (line.starts_with('[') || line.starts_with("WARNING")) {
        state.fetching_announced = true;
        emit_progress(
            app,
            "download:progress",
            Progress {
                stage: "fetching".into(),
                ..Default::default()
            },
        );
    }
}

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    #[allow(unused_variables)] state: State<'_, ActiveDownload>,
    url: String,
    format: String,
    quality: String,
    kind: String,
) -> Result<(), String> {
    emit_progress(
        &app,
        "download:progress",
        Progress {
            stage: "preparing".into(),
            ..Default::default()
        },
    );
    tools::ensure_ffmpeg(&app).await?;
    let dest = tools::downloads_dir(&app)?;
    let args = job_args(&dest, &format, &quality, &kind);

    log("download", format!("start {kind} {format} q={quality}: {url}"));

    #[cfg(target_os = "android")]
    {
        return start_on_android(app, args, url);
    }

    #[cfg(not(target_os = "android"))]
    {
        let ytdlp = tools::ytdlp_path(&app)?;
        let mut cmd = tools::quiet_command(&ytdlp);
        cmd.args(&args);
        if let Some(ffmpeg) = tools::managed_ffmpeg(&app) {
            cmd.arg("--ffmpeg-location").arg(ffmpeg.parent().unwrap());
        }
        cmd.arg(&url).stdout(Stdio::piped()).stderr(Stdio::piped());
        start_on_desktop(app, state, cmd)
    }
}

/// Android: the engine owns the process, so there is no child to hold and no
/// pipes to read — lines arrive on a channel and the job is done when the
/// call returns.
#[cfg(target_os = "android")]
fn start_on_android(app: AppHandle, mut args: Vec<String>, url: String) -> Result<(), String> {
    use std::sync::Mutex as StdMutex;

    args.push(url);
    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let reading = std::sync::Arc::new(StdMutex::new(Reading::default()));
        let for_lines = (app2.clone(), reading.clone());
        let result = crate::android_engine::run(&app2, args, move |line| {
            let (app, reading) = &for_lines;
            log("yt-dlp", line.clone());
            read_line(app, &line, &mut reading.lock().unwrap());
        });
        let (path, last_error) = {
            let reading = reading.lock().unwrap();
            (reading.final_path.clone(), reading.last_error.clone())
        };
        match result {
            Ok(()) => {
                let path = path.unwrap_or_default();
                log("download", format!("done: {path}"));
                emit_done(&app2, "download:done", path);
            }
            Err(message) => {
                // The engine's own error is often empty — it fails the call
                // without saying why. yt-dlp already said why, on the line
                // before it gave up.
                let message = match message.trim() {
                    "" => last_error.unwrap_or_else(|| "the download failed".into()),
                    m => m.to_string(),
                };
                log("download", format!("failed: {message}"));
                let _ = app2.emit("download:error", message);
            }
        }
    });
    Ok(())
}

#[cfg(not(target_os = "android"))]
fn start_on_desktop(
    app: AppHandle,
    state: State<'_, ActiveDownload>,
    mut cmd: std::process::Command,
) -> Result<(), String> {
    let mut child = cmd.spawn().map_err(|e| format!("could not start yt-dlp: {e}"))?;
    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    *state.0.lock().unwrap() = Some(child);

    let stderr_task = tauri::async_runtime::spawn_blocking(move || {
        BufReader::new(stderr)
            .lines()
            .map_while(Result::ok)
            .collect::<Vec<_>>()
    });

    let app2 = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut reading = Reading::default();
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            read_line(&app2, &line, &mut reading);
        }
        let final_path = reading.final_path;

        let status = {
            let state = app2.state::<ActiveDownload>();
            let child = state.0.lock().unwrap().take();
            child.map(|mut c| c.wait())
        };

        match status {
            Some(Ok(s)) if s.success() => {
                let path = final_path.unwrap_or_default();
                log("download", format!("done: {path}"));
                emit_done(&app2, "download:done", path);
            }
            None => log("download", "cancelled"), // frontend already reset itself
            _ => {
                let msg = tauri::async_runtime::block_on(stderr_task)
                    .map(|lines| {
                        for l in &lines {
                            log("yt-dlp", l.clone());
                        }
                        lines
                            .iter()
                            .rev()
                            .find(|l| l.starts_with("ERROR"))
                            .cloned()
                            .unwrap_or_else(|| lines.last().cloned().unwrap_or_default())
                    })
                    .unwrap_or_default();
                let msg = if msg.is_empty() {
                    "yt-dlp exited with an error".to_string()
                } else {
                    msg
                };
                log("download", format!("failed: {msg}"));
                let _ = app2.emit("download:error", msg);
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_download(
    #[allow(unused_variables)] app: AppHandle,
    #[allow(unused_variables)] state: State<'_, ActiveDownload>,
) {
    #[cfg(target_os = "android")]
    crate::android_engine::cancel(&app);

    #[cfg(not(target_os = "android"))]
    if let Some(mut child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}
