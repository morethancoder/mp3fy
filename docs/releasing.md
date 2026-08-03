# Releasing

A release is a tag. Pushing `vX.Y.Z` starts
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which
builds mp3fy on three runners and attaches the bundles to a GitHub Release:

| Runner | Produces |
| --- | --- |
| `macos-latest` | `.dmg` and `.app.tar.gz`, built `--target universal-apple-darwin` (Apple Silicon + Intel in one file) |
| `ubuntu-24.04` | `.deb`, `.rpm`, `.AppImage` |
| `windows-latest` | `.msi` and NSIS `-setup.exe` |
| `ubuntu-24.04` (android job) | a signed universal `.apk`, uploaded to the release the others created |

## Cutting one

```sh
make release            # asks for the version, or: make release VERSION=0.2.0
```

`scripts/release.sh` does the tedious half and refuses to do the dangerous
half blind:

1. checks the tree is clean and you are on `main`
2. checks `make check` passes
3. writes the new version to `package.json`, `src-tauri/Cargo.toml`,
   `src-tauri/tauri.conf.json` and `Cargo.lock`
4. commits `release: vX.Y.Z`, tags it, and (after you confirm) pushes both

Watch the run with `gh run watch`, and the result appears at
`https://github.com/morethancoder/mp3fy/releases/tag/vX.Y.Z`.

## Doing it by hand

```sh
# bump the three version fields, then
git commit -am "release: v0.2.0"
git tag v0.2.0
git push origin main --follow-tags
```

Re-running a release for the same tag: delete the release and the tag on the
remote (`gh release delete v0.2.0 --cleanup-tag`), then push it again.

## Signing

**Android is signed**, with a key that is not in the repo: `~/.mp3fy/mp3fy-release.jks`
locally, and the `ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` /
`ANDROID_KEY_ALIAS` repository secrets in CI. Back that keystore up — Android
identifies an app by its signing key, so losing it means no future build can
update an installed mp3fy. See [android.md](android.md#signing).

**Desktop is not signed.** macOS bundles get quarantined and Windows shows
SmartScreen until they are — see the install notes in the
[README](../README.md#install).
Adding signing later means:

- **macOS**: an Apple Developer ID certificate plus notarisation credentials in
  `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.
- **Windows**: a code-signing certificate and a `bundle.windows.signCommand`.

Both are read straight from the environment by `tauri-action`, so it is a
secrets-only change to the workflow.

## Updating in place

There is no updater yet. Users download the new release and install over the
old one. Whenever that changes, note that the bundle identifier
`com.morethancoder.mp3fy` must not move — Android is planned on the same id and
changing it breaks in-place updates everywhere.
