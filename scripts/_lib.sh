# Shared helpers for scripts/*.sh — source, don't execute.

C_RESET=$'\033[0m'
C_BOLD=$'\033[1m'
C_CYAN=$'\033[36m'
C_GREEN=$'\033[32m'
C_YELLOW=$'\033[33m'
C_RED=$'\033[31m'

say()  { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s%s%s\n' "$C_CYAN" "$C_RESET" "$C_BOLD" "$*" "$C_RESET"; }
ok()   { printf '%s ✓ %s%s\n' "$C_GREEN" "$C_RESET" "$*"; }
warn() { printf '%s ! %s%s\n' "$C_YELLOW" "$C_RESET" "$*"; }
err()  { printf '%s ✗ %s%s\n' "$C_RED" "$C_RESET" "$*" >&2; }

load_env() {
  if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
  fi
}

require_cli() { # require_cli <name> <hint>
  if command -v "$1" >/dev/null 2>&1; then
    ok "$1 ($(command -v "$1"))"
  else
    err "missing CLI: $1 — $2"
    return 1
  fi
}

check_cli() { # like require_cli but warns instead of failing
  if command -v "$1" >/dev/null 2>&1; then
    ok "$1 ($(command -v "$1"))"
  else
    warn "missing CLI: $1 — $2"
  fi
}

confirm() { # confirm <question> — auto-passes in CI
  [ "${CI:-}" = "1" ] && return 0
  printf '%s?%s %s [y/N] ' "$C_YELLOW" "$C_RESET" "$1"
  read -r reply
  [ "$reply" = "y" ] || [ "$reply" = "Y" ]
}
