//! A small in-memory ring buffer of app events, surfaced at
//! Settings → Developer → Logs. Sources: "tools", "download", "convert",
//! "ui" (forwarded frontend errors via `log_event`).

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const CAP: usize = 500;

static LOGS: Mutex<VecDeque<LogEntry>> = Mutex::new(VecDeque::new());

#[derive(Clone, serde::Serialize)]
pub struct LogEntry {
    pub ts: u64, // unix millis
    pub source: String,
    pub message: String,
}

pub fn log(source: &str, message: impl Into<String>) {
    let entry = LogEntry {
        ts: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
        source: source.to_string(),
        message: message.into(),
    };
    // Also to stderr: a GUI launch throws it away, but running the binary
    // from a terminal is how you watch the app work without the Logs screen.
    eprintln!("[{}] {}", entry.source, entry.message);

    let mut logs = LOGS.lock().unwrap();
    if logs.len() >= CAP {
        logs.pop_front();
    }
    logs.push_back(entry);
}

/// Newest first — the order the Logs screen shows them.
#[tauri::command]
pub fn get_logs() -> Vec<LogEntry> {
    LOGS.lock().unwrap().iter().rev().cloned().collect()
}

#[tauri::command]
pub fn log_event(source: String, message: String) {
    log(&source, message);
}
