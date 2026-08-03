//! Local file conversion: any video/audio file the user picks → the chosen
//! audio format, straight into the mp3fy downloads folder. Progress comes
//! from `ffmpeg -progress pipe:1` measured against the duration ffmpeg
//! itself reports for the input.

use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Child, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::download::{emit_done, emit_progress, Progress};
use crate::logs::log;
use crate::tools;

#[derive(Default)]
pub struct ActiveConvert(pub Mutex<Option<Child>>);

/// "Duration: 00:03:12.45" from `ffmpeg -i` — seconds, from ffmpeg's stderr
/// banner so we don't also need ffprobe.
fn probe_duration(app: &AppHandle, input: &Path) -> Option<f64> {
    let out = tools::quiet_command(&tools::ffmpeg_program(app))
        .arg("-i")
        .arg(input)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stderr);
    let rest = text.split("Duration: ").nth(1)?;
    let stamp = rest.split([',', '\n']).next()?.trim();
    let mut parts = stamp.split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let s: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + s)
}

fn codec_args(format: &str, quality: &str) -> Vec<String> {
    let mut args: Vec<String> = vec!["-vn".into()];
    match format {
        "mp3" => {
            args.extend(["-c:a".into(), "libmp3lame".into()]);
            match quality {
                "best" => args.extend(["-q:a".into(), "0".into()]),
                q => args.extend(["-b:a".into(), format!("{q}k")]),
            }
        }
        "m4a" => {
            args.extend(["-c:a".into(), "aac".into()]);
            let bitrate = if quality == "best" { "256" } else { quality };
            args.extend(["-b:a".into(), format!("{bitrate}k")]);
        }
        "opus" => {
            args.extend(["-c:a".into(), "libopus".into()]);
            let bitrate = if quality == "best" { "192" } else { quality };
            args.extend(["-b:a".into(), format!("{bitrate}k")]);
        }
        // flac and wav are lossless — quality does not apply.
        "flac" => args.extend(["-c:a".into(), "flac".into()]),
        "wav" => args.extend(["-c:a".into(), "pcm_s16le".into()]),
        other => {
            args.extend(["-f".into(), other.to_string()]);
        }
    }
    args
}

#[tauri::command]
pub async fn convert_file(
    app: AppHandle,
    state: State<'_, ActiveConvert>,
    input: String,
    format: String,
    quality: String,
) -> Result<(), String> {
    emit_progress(
        &app,
        "convert:progress",
        Progress {
            stage: "preparing".into(),
            ..Default::default()
        },
    );
    tools::ensure_ffmpeg(&app).await?;

    let input_path = std::path::PathBuf::from(&input);
    let stem = input_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("converted");
    let dest = tools::downloads_dir(&app)?;
    let mut output = dest.join(format!("{stem}.{format}"));
    // Never overwrite silently — pick "name (2).ext" like a browser would.
    let mut n = 2;
    while output.exists() {
        output = dest.join(format!("{stem} ({n}).{format}"));
        n += 1;
    }

    let duration = probe_duration(&app, &input_path);

    let mut cmd = tools::quiet_command(&tools::ffmpeg_program(&app));
    cmd.arg("-i")
        .arg(&input_path)
        .args(codec_args(&format, &quality))
        .args(["-progress", "pipe:1", "-nostats", "-y"])
        .arg(&output)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    log("convert", format!("start {format} q={quality}: {input}"));
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("could not start ffmpeg: {e}"))?;
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
    let out_path = output.to_string_lossy().into_owned();
    tauri::async_runtime::spawn_blocking(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            // -progress emits key=value lines; out_time_us counts microseconds.
            let Some(us) = line
                .strip_prefix("out_time_us=")
                .or_else(|| line.strip_prefix("out_time_ms="))
            else {
                continue;
            };
            let done_secs = us.trim().parse::<f64>().unwrap_or(0.0) / 1_000_000.0;
            let percent = duration
                .filter(|d| *d > 0.0)
                .map(|d| (done_secs / d * 100.0).clamp(0.0, 100.0));
            emit_progress(
                &app2,
                "convert:progress",
                Progress {
                    stage: "converting".into(),
                    percent,
                    ..Default::default()
                },
            );
        }

        let status = {
            let state = app2.state::<ActiveConvert>();
            let child = state.0.lock().unwrap().take();
            child.map(|mut c| c.wait())
        };

        match status {
            Some(Ok(s)) if s.success() => {
                log("convert", format!("done: {out_path}"));
                emit_done(&app2, "convert:done", out_path);
            }
            None => {
                log("convert", "cancelled");
                let _ = std::fs::remove_file(&out_path); // drop the partial file
            }
            _ => {
                let _ = std::fs::remove_file(&out_path);
                let tail = tauri::async_runtime::block_on(stderr_task)
                    .map(|lines| {
                        for l in lines.iter().rev().take(10) {
                            log("ffmpeg", l.clone());
                        }
                        lines.last().cloned().unwrap_or_default()
                    })
                    .unwrap_or_default();
                let msg = if tail.is_empty() {
                    "ffmpeg exited with an error".to_string()
                } else {
                    tail
                };
                log("convert", format!("failed: {msg}"));
                let _ = app2.emit("convert:error", msg);
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_convert(state: State<'_, ActiveConvert>) {
    if let Some(mut child) = state.0.lock().unwrap().take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}
