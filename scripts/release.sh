#!/usr/bin/env bash
# Cut a release: bump the three version fields, commit, tag, push. GitHub
# Actions does the building — see docs/releasing.md.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/_lib.sh
load_env

VERSION="${VERSION:-${1:-}}"

step "Checking the working tree"
if [ -n "$(git status --porcelain)" ]; then
  err "uncommitted changes — commit or stash them first"
  exit 1
fi
ok "tree is clean"

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" != "main" ]; then
  warn "on branch '$branch', not main"
  confirm "Tag from '$branch' anyway" || exit 1
fi

current="$(node -p "require('./package.json').version")"
say "current version: $current"

if [ -z "$VERSION" ]; then
  printf '%s?%s new version (x.y.z): ' "$C_YELLOW" "$C_RESET"
  read -r VERSION
fi

if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  err "'$VERSION' is not a x.y.z version"
  exit 1
fi

if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  err "tag v$VERSION already exists"
  exit 1
fi

step "Type-checking before tagging"
pnpm check
(cd src-tauri && cargo check)

step "Writing version $VERSION"
node -e '
  const fs = require("fs");
  const v = process.argv[1];
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  pkg.version = v;
  fs.writeFileSync("package.json", JSON.stringify(pkg, null, "\t") + "\n");

  const conf = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
  conf.version = v;
  fs.writeFileSync("src-tauri/tauri.conf.json", JSON.stringify(conf, null, "\t") + "\n");

  const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
  fs.writeFileSync(
    "src-tauri/Cargo.toml",
    cargo.replace(/^version = ".*"$/m, `version = "${v}"`)
  );
' "$VERSION"
# Keeps Cargo.lock in step with the manifest, so the tag builds reproducibly.
(cd src-tauri && cargo update --workspace --offline >/dev/null 2>&1 || cargo check --quiet)
ok "package.json, tauri.conf.json and Cargo.toml now say $VERSION"

step "Committing and tagging"
git add -A
git commit -m "release: v$VERSION"
git tag -a "v$VERSION" -m "mp3fy v$VERSION"
ok "tagged v$VERSION"

if confirm "Push main and the tag to origin (this starts the release build)"; then
  git push origin "$branch" --follow-tags
  ok "pushed — watch it with 'gh run watch'"
else
  warn "not pushed. When you are ready: git push origin $branch --follow-tags"
fi
