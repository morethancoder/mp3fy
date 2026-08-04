#!/usr/bin/env bash
# Regenerate every icon in the project from src-tauri/app-icon.png.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/_lib.sh
source scripts/_lib.sh

step "Generating icons from src-tauri/app-icon.png"
pnpm tauri icon src-tauri/app-icon.png
ok "desktop, iOS and legacy Android icons"

# tauri icon hands Android the whole artwork as the adaptive foreground, which
# the launcher then crops and masks — see the script's header.
step "Rebuilding the Android adaptive icon"
if command -v uv >/dev/null 2>&1; then
  uv run --quiet --with pillow python3 scripts/android-adaptive-icon.py
  ok "adaptive foreground and plum background"
else
  err "missing CLI: uv — needed for the Android adaptive icon (brew install uv)"
  warn "the APK will ship a zoomed-in, hard-cropped launcher icon until this runs"
  exit 1
fi
