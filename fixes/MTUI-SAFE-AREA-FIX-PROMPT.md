# MTUI suggestion: `env(safe-area-inset-*)` is not enough on Android

## Problem

`layout.css` keeps the shell clear of the hardware with the platform's own
answer:

```css
.shell-header { padding-block-start: calc(var(--sp-8) + env(safe-area-inset-top, 0px)); }
.shell-nav    { padding-block-end: env(safe-area-inset-bottom, 0px); }
```

That is correct on iOS, iPadOS and macOS. On **Android WebView it silently
resolves to `0px` for the system bars**: the env() variables there describe
the *display cutout* and nothing else. The status bar, the navigation bar and
the gesture pill are invisible to CSS, no matter what `viewport-fit=cover`
says.

It only became visible now because it takes an edge-to-edge window to expose
it — and from `targetSdk 35` every Android app has one whether it asks or not
(`androidx.activity.enableEdgeToEdge`, or the system doing it anyway). In
mp3fy 0.2.5 on Android 15 the result was:

| Element | Expected | Actual |
| --- | --- | --- |
| `.shell-header` top padding | `8px + 24px` status bar | `8px` — the app name sits level with the clock |
| a corner-pinned overlay button | clear of the bar | under the status bar, half of it untappable |
| `.shell-nav` bottom padding | `~24px` gesture bar | `0px` on a gesture-navigation device |

A phone with a cutout gets *some* inset, which is what makes this look like it
works: the number is real, it is just the wrong number, and a phone with a
hole-punch camera and a 24px status bar reports the hole punch.

## Why the host has to measure it

There is no CSS or JS API that reports Android's system-bar insets to a page.
`WindowInsetsCompat` in the host application is the only source, so any fix
needs one value passed in from outside the document.

## Suggested change

Have the shell spend a variable that a host can raise, and fall back to env()
when nobody does:

```css
:root {
  --safe-top: max(env(safe-area-inset-top, 0px), var(--safe-area-top, 0px));
  --safe-bottom: max(env(safe-area-inset-bottom, 0px), var(--safe-area-bottom, 0px));
  --safe-left: max(env(safe-area-inset-left, 0px), var(--safe-area-left, 0px));
  --safe-right: max(env(safe-area-inset-right, 0px), var(--safe-area-right, 0px));
}

.shell-header { padding-block-start: calc(var(--sp-8) + var(--safe-top)); }
.shell-nav    { padding-block-end: var(--safe-bottom); }
```

`max()` rather than a plain override, so a host that sets nothing behaves
exactly as today and a host that sets `--safe-area-top: 24px` cannot end up
*below* what CSS already knew. Documenting the four `--safe-area-*` inputs is
the whole API; the host writes them onto `documentElement` and re-writes them
when the window resizes.

It would also be worth saying in the docs that a screen preset or overlay
which pins something to a window corner should spend these too — the shell
padding does not reach `position: fixed` children.

## What mp3fy does meanwhile

The same shape, one specificity step up, in `src/app.css` (section 0):
`--safe-top-css` … `--safe-right-css` fold env() together with `--safe-*`,
which `src/lib/safe-area.ts` fills from `YtdlpPlugin.insets` (Kotlin,
`WindowInsetsCompat` → CSS pixels) on load and on every resize. The header,
the tab bar, `.screen-stack` and the player overlay all spend the folded
values. Nothing about it is Android-specific except where the numbers come
from — on desktop the command answers zero and env() keeps doing the work.
