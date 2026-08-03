#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_lib.sh
load_env

case "$(uname -s)" in
  Darwin)
    node_hint="install via https://nodejs.org or 'brew install node'"
    pnpm_hint="install via 'npm i -g pnpm' or 'brew install pnpm'"
    rust_hint="install via https://rustup.rs"
    ;;
  *)
    node_hint="install via https://nodejs.org or your package manager"
    pnpm_hint="install via 'npm i -g pnpm'"
    rust_hint="install via https://rustup.rs (plus Tauri's Linux deps: https://tauri.app/start/prerequisites/)"
    ;;
esac

step "Checking required tools"
fail=0
require_cli node "$node_hint" || fail=1
require_cli pnpm "$pnpm_hint" || fail=1
require_cli cargo "$rust_hint" || fail=1
require_cli rustc "$rust_hint" || fail=1

if command -v node >/dev/null 2>&1; then
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  if [ "$node_major" -ge 22 ]; then
    ok "node $(node -v) meets the >=22 requirement"
  else
    err "node $(node -v) is too old — mp3fy needs 22 or newer"
    fail=1
  fi
fi

step "Checking optional tools"
# The app downloads its own yt-dlp and ffmpeg into the app data dir on first
# run, so neither is required — a system ffmpeg just skips that download.
check_cli ffmpeg "optional — fetched automatically on first download if missing"
check_cli yt-dlp "optional — the app manages its own copy"

step "Checking project state"
if [ -d node_modules ]; then
  ok "node_modules present"
else
  warn "node_modules missing — run 'make setup'"
fi

if [ "$fail" = "1" ]; then
  err "doctor found problems"
  exit 1
fi
ok "all good"
