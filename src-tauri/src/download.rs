//! The download pipeline: spawn yt-dlp, stream its progress lines to the
//! frontend as events, and hand back the final media file path.
//!
//! Stages emitted: `fetching` (metadata), `downloading` (with percent, size,
//! speed and ETA parsed from yt-dlp's own progress line), `converting`
//! (ffmpeg post-processing / remuxing). The frontend owns the wording — we
//! only send structure, so the UI can localise it.

use std::io::{BufRead, BufReader};
use std::process::{Child, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

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

#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, ActiveDownload>,
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
    let ytdlp = tools::ytdlp_path(&app)?;
    let dest = tools::downloads_dir(&app)?;

    let mut cmd = tools::quiet_command(&ytdlp);
    if kind == "video" {
        cmd.args(["-f", "bv*+ba/b", "--remux-video", &format]);
    } else {
        cmd.args(["-x", "--audio-format", &format]);
        match quality.as_str() {
            "best" => cmd.args(["--audio-quality", "0"]),
            q => cmd.args(["--audio-quality", &format!("{q}K")]),
        };
    }
    cmd.args(["--newline", "--no-playlist", "--no-mtime"])
        .arg("-o")
        .arg(dest.join("%(title)s.%(ext)s"));
    if let Some(ffmpeg) = tools::managed_ffmpeg(&app) {
        cmd.arg("--ffmpeg-location").arg(ffmpeg.parent().unwrap());
    }
    cmd.arg(&url).stdout(Stdio::piped()).stderr(Stdio::piped());

    log("download", format!("start {kind} {format} q={quality}: {url}"));
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
        let mut final_path: Option<String> = None;
        let mut fetching_announced = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(path) = parse_destination(&line) {
                final_path = Some(path);
            }
            if line.starts_with("[download]") {
                if line.contains('%') {
                    emit_progress(&app2, "download:progress", parse_download_line(&line));
                }
            } else if line.starts_with("[ExtractAudio]")
                || line.starts_with("[Merger]")
                || line.starts_with("[VideoRemuxer]")
            {
                emit_progress(
                    &app2,
                    "download:progress",
                    Progress {
                        stage: "converting".into(),
                        ..Default::default()
                    },
                );
            } else if !fetching_announced && (line.starts_with('[') || line.starts_with("WARNING"))
            {
                fetching_announced = true;
                emit_progress(
                    &app2,
                    "download:progress",
                    Progress {
                        stage: "fetching".into(),
                        ..Default::default()
                    },
                );
            }
        }

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
pub fn cancel_download(state: State<'_, ActiveDownload>) {
    if let Some(mut child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}
