#!/usr/bin/env bash
# Throw away everything a build can recreate, and say how much that was.
#
# Rust and Gradle both cache generously and neither ever shrinks: a debug
# target tree, a release one, one per Android ABI, and Gradle's own
# intermediates had reached 12 GB between them. Run this after a debugging
# session rather than discovering it a month later.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=scripts/_lib.sh
source scripts/_lib.sh

TARGETS=(
  .svelte-kit
  build
  .playwright
  src-tauri/target                    # cargo: debug, release and every Android ABI
  src-tauri/gen/android/app/build     # gradle: intermediates and built APKs
  src-tauri/gen/android/.gradle       # gradle: per-project daemon state
)

freed=0
for path in "${TARGETS[@]}"; do
  [ -e "$path" ] || continue
  size=$(du -sk "$path" 2>/dev/null | cut -f1)
  rm -rf "$path"
  freed=$((freed + size))
  say "  removed $path ($((size / 1024)) MB)"
done

if [ "$freed" -eq 0 ]; then
  ok "already clean"
else
  ok "cleaned — $((freed / 1024)) MB freed"
fi
