//! A loopback HTTP server, so the player can stream a file instead of
//! swallowing it.
//!
//! `<audio src=convertFileSrc(path)>` never worked on Android: a custom scheme
//! is answered through `shouldInterceptRequest` with one `WebResourceResponse`
//! built from a byte array, and Tauri's asset protocol caps a range response at
//! 1000 KiB — so the element got a megabyte, once, and stopped. The workaround
//! was to `fetch` the whole file and play it from a `blob:` URL, which is fine
//! for a three-minute song and absurd for an hour of recitation: a 200 MB file
//! is 200 MB of webview heap before the first sample, if it does not simply
//! fail to allocate.
//!
//! Real players do the obvious thing, and so does this now: serve the file over
//! HTTP on 127.0.0.1 with proper `Range` support. That goes through the
//! platform's own network stack rather than the custom-scheme interception, so
//! every webview — Android's included — asks for the ranges it wants, when it
//! wants them, and seeks by asking for a different one. Nothing is buffered
//! here beyond a 64 KiB copy buffer.
//!
//! The port is ephemeral and every URL carries a secret generated at startup,
//! because a loopback socket on Android is reachable by every other app on the
//! phone. Without the secret the server answers 404 and nothing else.
//!
//! There are deliberately no CORS headers. `<audio src>` is a no-CORS load and
//! needs none; `fetch()` from the page would need them, and it has no business
//! reading these files — the player streams, it does not download. If you find
//! yourself adding `Access-Control-Allow-Origin` here, check first that you are
//! not reinventing the blob.

use std::collections::HashSet;
use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// The files `media_url` has handed out a URL for, and therefore the only ones
/// the server will open.
///
/// The secret alone would do for keeping other apps out, but a secret is one
/// leak away from being an arbitrary-file-read primitive, and a media server
/// has no business reading anything the player did not ask for. This is the
/// list it did ask for: one entry per track played this session, gone when the
/// app exits.
type Allowed = Arc<Mutex<HashSet<String>>>;

/// Where the frontend should point a media element. Managed by Tauri once the
/// listener is up; its absence is what makes `media_url` fail loudly.
pub struct MediaServer {
    /// `http://127.0.0.1:<port>/<secret>` — the prefix every URL is built on.
    base: String,
    allowed: Allowed,
}

/// Start listening. Returns the base URL, or the reason there isn't one.
pub fn start() -> Result<MediaServer, String> {
    // Port 0: the OS picks a free one. A fixed port would collide with
    // whatever else the machine is running, and two copies of the app.
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let secret = secret();
    let base = format!("http://127.0.0.1:{port}/{secret}");
    let allowed: Allowed = Arc::default();

    let served = allowed.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let secret = secret.clone();
            let served = served.clone();
            // A thread per connection. The only client is this app's webview,
            // which opens a handful — one for the current read, one more while
            // a seek settles.
            std::thread::spawn(move || serve(stream, &secret, &served));
        }
    });

    Ok(MediaServer { base, allowed })
}

/// The URL for a local file, for the player to hand to `<audio>`.
#[tauri::command]
pub fn media_url(app: tauri::AppHandle, path: String) -> Result<String, String> {
    use tauri::Manager as _;
    let server = app
        .try_state::<MediaServer>()
        .ok_or_else(|| "the media server did not start".to_string())?;
    if !Path::new(&path).is_file() {
        return Err(format!("{path} is not a file"));
    }
    // The path is remembered exactly as it will arrive back over the wire —
    // no canonicalising, or the two would stop matching for a symlinked
    // Downloads folder and every track would 404.
    server
        .allowed
        .lock()
        .map_err(|_| "the media server's file list is poisoned".to_string())?
        .insert(path.clone());
    Ok(format!("{}/file?path={}", server.base, encode(&path)))
}

/// 128 bits nobody else can guess, without pulling in a random-number crate.
///
/// `RandomState` is seeded from the OS once per thread and bumped per
/// instance, which is exactly the property needed here — this runs once, at
/// startup, and the value only has to be unguessable by another process.
fn secret() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut halves = [0u64; 2];
    for (i, half) in halves.iter_mut().enumerate() {
        let mut hasher = RandomState::new().build_hasher();
        hasher.write_usize(i);
        hasher.write_u128(nanos);
        *half = hasher.finish();
    }
    format!("{:016x}{:016x}", halves[0], halves[1])
}

/* ---- The server itself ---- */

fn serve(stream: TcpStream, secret: &str, allowed: &Allowed) {
    // A connection that opens and then says nothing must not hold a thread
    // forever. Reads only: a paused element stops draining its socket for
    // minutes at a time, and a write timeout would kill that as a failure.
    let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(15)));
    let Ok(peer) = stream.try_clone() else { return };
    let mut reader = BufReader::new(peer);

    let Some((method, target)) = request_line(&mut reader) else {
        return;
    };
    let range = header(&mut reader, "range");

    if method != "GET" && method != "HEAD" {
        return respond(stream, 405, "Method Not Allowed", &[], None);
    }

    // `/<secret>/file?path=<percent-encoded>`, and nothing else. Anything that
    // does not carry the secret is another app poking at the port.
    let Some(query) = target
        .strip_prefix(&format!("/{secret}/file?path="))
        .filter(|q| !q.is_empty())
    else {
        return respond(stream, 404, "Not Found", &[], None);
    };
    let path = decode(query);

    // Only what the player asked for. Everything else on the disk is somebody
    // else's business, secret or no secret.
    let known = allowed.lock().map(|set| set.contains(&path)).unwrap_or(false);
    if !known {
        return respond(stream, 404, "Not Found", &[], None);
    }
    let path = Path::new(&path);

    // A directory opens quite happily on Unix and then fails to read, which
    // would be a stalled connection rather than an answer.
    let (Ok(mut file), Ok(meta)) = (File::open(path), std::fs::metadata(path)) else {
        return respond(stream, 404, "Not Found", &[], None);
    };
    if !meta.is_file() {
        return respond(stream, 404, "Not Found", &[], None);
    }
    let len = meta.len();

    let (status, reason, start, end) = match parse_range(range.as_deref(), len) {
        Ok(None) => (200, "OK", 0, len.saturating_sub(1)),
        Ok(Some((start, end))) => (206, "Partial Content", start, end),
        // A seek past the end, or a header we could not read. Saying so is what
        // lets the element recover instead of hanging on a reply that never
        // matches what it asked for.
        Err(()) => {
            let headers = [format!("Content-Range: bytes */{len}")];
            return respond(stream, 416, "Range Not Satisfiable", &headers, None);
        }
    };

    // An empty file has no byte 0 to serve; `end` would underflow past `start`.
    let count = if len == 0 { 0 } else { end - start + 1 };
    let headers = [
        format!("Content-Type: {}", content_type(path)),
        format!("Content-Length: {count}"),
        "Accept-Ranges: bytes".to_string(),
        // Seeking rewrites the same URL with a different Range; a cached
        // response would be answering the wrong question.
        "Cache-Control: no-store".to_string(),
        format!("Content-Range: bytes {start}-{end}/{len}"),
    ];
    // Only a 206 may carry Content-Range.
    let headers = &headers[..if status == 206 { 5 } else { 4 }];

    if method == "HEAD" || count == 0 {
        return respond(stream, status, reason, headers, None);
    }
    if file.seek(SeekFrom::Start(start)).is_err() {
        return respond(stream, 500, "Internal Server Error", &[], None);
    }
    respond(stream, status, reason, headers, Some(file.take(count)));
}

fn request_line(reader: &mut BufReader<TcpStream>) -> Option<(String, String)> {
    let mut line = String::new();
    if reader.read_line(&mut line).ok()? == 0 || line.len() > 8 * 1024 {
        return None;
    }
    let mut parts = line.split_whitespace();
    Some((parts.next()?.to_string(), parts.next()?.to_string()))
}

/// The one header this server cares about. Reads to the end of the head either
/// way, so the client is not left writing into a socket nobody drained.
fn header(reader: &mut BufReader<TcpStream>, name: &str) -> Option<String> {
    let mut found = None;
    let mut read = 0usize;
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => return found,
            Ok(n) => read += n,
            Err(_) => return found,
        }
        if line == "\r\n" || line == "\n" || read > 16 * 1024 {
            return found;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        if key.trim().eq_ignore_ascii_case(name) {
            found = Some(value.trim().to_string());
        }
    }
}

/// `Ok(None)` — no Range asked for. `Err` — asked for one the file cannot
/// satisfy, which is a 416 and not a silent full body.
fn parse_range(header: Option<&str>, len: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(spec) = header else { return Ok(None) };
    let spec = spec.trim().strip_prefix("bytes=").ok_or(())?;
    // Multipart ranges are legal and no media element sends them; honouring the
    // first one is both simpler and what every file server in practice does.
    let spec = spec.split(',').next().ok_or(())?.trim();
    let (from, to) = spec.split_once('-').ok_or(())?;
    let last = len.saturating_sub(1);

    let (start, end) = if from.is_empty() {
        // `bytes=-500`: the final 500 bytes. This is how an m4a with its moov
        // atom at the end gets its duration.
        let suffix: u64 = to.parse().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        (len.saturating_sub(suffix), last)
    } else {
        let start: u64 = from.parse().map_err(|_| ())?;
        let end = if to.is_empty() {
            last
        } else {
            to.parse::<u64>().map_err(|_| ())?.min(last)
        };
        (start, end)
    };

    if len == 0 || start > last || start > end {
        return Err(());
    }
    Ok(Some((start, end)))
}

fn respond(
    stream: TcpStream,
    status: u16,
    reason: &str,
    headers: &[String],
    body: Option<std::io::Take<File>>,
) {
    let mut head = format!("HTTP/1.1 {status} {reason}\r\n");
    for header in headers {
        head.push_str(header);
        head.push_str("\r\n");
    }
    // One request per connection. Keep-alive would save a socket per seek and
    // cost a length-delimited reader; the client is one webview on loopback.
    head.push_str("Connection: close\r\n\r\n");

    let mut out = BufWriter::with_capacity(64 * 1024, stream);
    // Every error from here on is the client hanging up — a track change, a
    // seek, a paused element deciding it has read enough. None of it is worth
    // a log line.
    if out.write_all(head.as_bytes()).is_err() {
        return;
    }
    if let Some(mut body) = body {
        let _ = std::io::copy(&mut body, &mut out);
    }
    let _ = out.flush();
}

/* ---- Odds and ends ---- */

/// Percent-encode everything outside the unreserved set, `/` included: this
/// goes in a query value, and a file name here can be any UTF-8 at all.
fn encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                out.push(byte as char)
            }
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// The inverse. `+` is left alone deliberately — this decodes what `encode`
/// wrote, and a file called `Track +1.mp3` must not come back with a space.
fn decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&value[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// What the extension implies — the same table as `$lib/format`'s `mimeFor`.
///
/// Sniffing is what the asset protocol did, and it called an m4a `audio/m4a`,
/// which is not a registered type and which a media element refuses outright.
fn content_type(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "opus" | "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        _ => "application/octet-stream",
    }
}

/// The only tests in the tree, because this is the only hand-written wire
/// protocol in it. Everything else here calls a library that was tested by
/// someone else; range arithmetic is ours, it is off-by-one country, and
/// getting it wrong looks exactly like the bug this file exists to fix —
/// audio that stops early or refuses to seek. `make check` runs them.
#[cfg(test)]
mod tests {
    use super::*;

    /// One request over a real socket, because the point is the bytes on the
    /// wire and not what the functions above believe they wrote.
    fn get(base: &str, path: &str, range: Option<&str>) -> (String, Vec<u8>) {
        let addr = base.trim_start_matches("http://");
        let (host, rest) = addr.split_once('/').unwrap();
        let mut s = std::net::TcpStream::connect(host).unwrap();
        let mut req = format!("GET /{rest}/file?path={} HTTP/1.1\r\nHost: x\r\n", encode(path));
        if let Some(r) = range {
            req.push_str(&format!("Range: {r}\r\n"));
        }
        req.push_str("\r\n");
        s.write_all(req.as_bytes()).unwrap();
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).unwrap();
        let split = buf.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        (
            String::from_utf8_lossy(&buf[..split]).into_owned(),
            buf[split + 4..].to_vec(),
        )
    }

    /// A server with one file behind it, allowed the way `media_url` would
    /// allow it. The name is deliberately awkward — a space, a `+` and Arabic,
    /// all of which a downloaded title really has.
    fn fixture(name: &str) -> (MediaServer, String, Vec<u8>) {
        let dir = std::env::temp_dir().join("mp3fy-media-tests");
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join(name);
        let body: Vec<u8> = (0..5000u32).map(|i| (i % 251) as u8).collect();
        std::fs::write(&file, &body).unwrap();
        let path = file.to_string_lossy().into_owned();
        let server = start().unwrap();
        server.allowed.lock().unwrap().insert(path.clone());
        (server, path, body)
    }

    #[test]
    fn serves_a_whole_file_when_nothing_is_asked_for() {
        let (server, path, body) = fixture("whole a+b ملف.m4a");
        let (head, got) = get(&server.base, &path, None);

        assert!(head.starts_with("HTTP/1.1 200 OK"), "{head}");
        // Sniffing is what got an m4a called `audio/m4a` and refused.
        assert!(head.contains("Content-Type: audio/mp4"), "{head}");
        assert!(head.contains("Content-Length: 5000"), "{head}");
        // Without this the element never asks for a second range at all.
        assert!(head.contains("Accept-Ranges: bytes"), "{head}");
        assert!(!head.contains("Content-Range"), "{head}");
        assert_eq!(got, body);
    }

    #[test]
    fn serves_the_ranges_a_media_element_asks_for() {
        let (server, path, body) = fixture("ranges a+b ملف.m4a");
        let base = &server.base;

        // What `<audio>` opens with, and the request the asset protocol
        // answered with a truncated megabyte.
        let (head, got) = get(base, &path, Some("bytes=0-"));
        assert!(head.starts_with("HTTP/1.1 206"), "{head}");
        assert!(head.contains("Content-Range: bytes 0-4999/5000"), "{head}");
        assert_eq!(got, body);

        // A seek.
        let (head, got) = get(base, &path, Some("bytes=100-199"));
        assert!(head.contains("Content-Range: bytes 100-199/5000"), "{head}");
        assert!(head.contains("Content-Length: 100"), "{head}");
        assert_eq!(got, body[100..200]);

        // How an m4a with its moov atom at the end finds out how long it is.
        let (head, got) = get(base, &path, Some("bytes=-500"));
        assert!(head.contains("Content-Range: bytes 4500-4999/5000"), "{head}");
        assert_eq!(got, body[4500..]);

        // Past the end: a 416 lets the element recover, silence does not.
        let (head, _) = get(base, &path, Some("bytes=9000-"));
        assert!(head.starts_with("HTTP/1.1 416"), "{head}");
        assert!(head.contains("Content-Range: bytes */5000"), "{head}");
    }

    #[test]
    fn hands_nothing_to_anyone_without_the_secret() {
        let (server, path, _) = fixture("secret a+b ملف.m4a");
        let (prefix, secret) = server.base.rsplit_once('/').unwrap();

        let guessed = format!("{prefix}/{}", "0".repeat(secret.len()));
        let (head, body) = get(&guessed, &path, None);
        assert!(head.starts_with("HTTP/1.1 404"), "{head}");
        assert!(body.is_empty());

        let (head, _) = get(&server.base, &format!("{path}.nope"), None);
        assert!(head.starts_with("HTTP/1.1 404"), "{head}");
    }

    /// The secret is one leak away from being an arbitrary-file-read
    /// primitive, so it is not the only thing standing in the way.
    #[test]
    fn serves_only_the_files_the_player_asked_for() {
        let (server, path, _) = fixture("allowlist a+b ملف.m4a");
        let neighbour = Path::new(&path).with_extension("secret.m4a");
        std::fs::write(&neighbour, b"not for you").unwrap();

        let (head, body) = get(
            &server.base,
            &neighbour.to_string_lossy(),
            None,
        );
        assert!(head.starts_with("HTTP/1.1 404"), "{head}");
        assert!(body.is_empty());

        // And it is the allow-list doing it, not the file being missing.
        assert!(neighbour.is_file());
        server
            .allowed
            .lock()
            .unwrap()
            .insert(neighbour.to_string_lossy().into_owned());
        let (head, body) = get(&server.base, &neighbour.to_string_lossy(), None);
        assert!(head.starts_with("HTTP/1.1 200"), "{head}");
        assert_eq!(body, b"not for you");

        std::fs::remove_file(&neighbour).unwrap();
    }

    #[test]
    fn round_trips_odd_names() {
        for name in ["/a/Track +1.mp3", "/سورة البقرة.m4a", "/100% real?.opus"] {
            assert_eq!(decode(&encode(name)), name);
        }
    }
}
