#!/usr/bin/env bash
# Build (or run) the Android app. Finds the JDK, SDK and NDK rather than
# asking you to remember three environment variables.
#
#   scripts/android.sh            signed release APK
#   scripts/android.sh debug      debug APK, arm64 only (much faster)
#   scripts/android.sh dev        run on a connected device/emulator
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_lib.sh
load_env

mode="${1:-release}"

step "Locating the Android toolchain"

if [ -z "${JAVA_HOME:-}" ] || [ ! -x "${JAVA_HOME}/bin/java" ]; then
  for candidate in \
    /opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
    /usr/lib/jvm/java-21-openjdk-amd64 \
    "/Applications/Android Studio.app/Contents/jbr/Contents/Home"; do
    if [ -x "$candidate/bin/java" ]; then
      export JAVA_HOME="$candidate"
      break
    fi
  done
fi
if [ -z "${JAVA_HOME:-}" ]; then
  err "no JDK found — install one (brew install openjdk@21) or set JAVA_HOME"
  exit 1
fi
export PATH="$JAVA_HOME/bin:$PATH"
ok "JDK $("$JAVA_HOME/bin/java" -version 2>&1 | head -1 | sed 's/.*"\(.*\)".*/\1/')"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ ! -d "$ANDROID_HOME" ]; then
  export ANDROID_HOME="$HOME/Android/Sdk"
fi
if [ ! -d "$ANDROID_HOME" ]; then
  err "no Android SDK found — install it, or set ANDROID_HOME"
  exit 1
fi
ok "SDK $ANDROID_HOME"

if [ -z "${NDK_HOME:-}" ]; then
  # Newest installed NDK wins.
  NDK_HOME="$(find "$ANDROID_HOME/ndk" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sort -V | tail -1)"
  export NDK_HOME
fi
if [ -z "${NDK_HOME:-}" ] || [ ! -d "$NDK_HOME" ]; then
  err "no NDK found — install one with: sdkmanager 'ndk;28.2.13676358'"
  exit 1
fi
ok "NDK $(basename "$NDK_HOME")"

case "$mode" in
  dev)
    step "Running on the connected device"
    exec pnpm tauri android dev
    ;;
  debug)
    step "Building a debug APK (arm64)"
    pnpm tauri android build --debug --target aarch64 --apk
    ;;
  release)
    if [ ! -f src-tauri/gen/android/key.properties ]; then
      warn "src-tauri/gen/android/key.properties is missing — the APK will be"
      warn "unsigned, which no device will install. See docs/releasing.md."
    fi
    step "Building a signed release APK"
    pnpm tauri android build --apk
    ;;
  *)
    err "unknown mode '$mode' — use dev, debug or release"
    exit 1
    ;;
esac

apk="$(find src-tauri/gen/android/app/build/outputs/apk -name '*.apk' -newermt '-10 minutes' 2>/dev/null | head -1)"
[ -n "$apk" ] && ok "APK: $apk"
