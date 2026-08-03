# MTUI bug report: `data-status` alerts render neutral grey

## Problem

`components.css` defines the shared semantic pairs around line 558:

```css
[data-status="danger"]  { background: var(--danger-tint);  color: var(--danger-text); }
```

…and then defines the alert base around line 1198:

```css
.alert {
  background: var(--surface-2);
  color: var(--text);
}
```

Both selectors are specificity 0-1-0, so **source order decides — and
`.alert` comes later**. Result: `<div class="alert" data-status="danger">`
(the exact markup the alert docs show) renders with the neutral surface
background and text color. The status pair only survives on components
whose base rules are declared *before* the shared pairs (badge/chip) — the
alert's are declared after, so every status alert in every app quietly
loses its color. `data-fill="solid"` alerts break the same way.

## Fix

Give the alert explicit status rules after its base (or move the shared
pairs after all component bases — but that risks the same bug inverted for
other components; explicit is safer):

```css
.alert[data-status="success"] { background: var(--success-tint); color: var(--success-text); }
.alert[data-status="warning"] { background: var(--warning-tint); color: var(--warning-text); }
.alert[data-status="danger"]  { background: var(--danger-tint);  color: var(--danger-text); }
.alert[data-status="info"]    { background: var(--info-tint);    color: var(--info-text); }
.alert[data-status="success"][data-fill="solid"] { background: var(--success); color: var(--on-success); }
/* …and the other three solid variants. */
```

Sweep the sheet for the same pattern while at it: any component whose base
sets `background`/`color` AND is declared after line ~558 has the same
latent bug (`.empty` is worth checking — it's listed as a consumer of the
shared pairs too).

## Acceptance

- `<div class="alert" data-status="danger">…</div>` shows the danger tint
  pair in light and dark themes with no app-side CSS.
- mp3fy's `src/app.css` section 5 workaround becomes deletable.

## Reference

mp3fy ships the workaround today (`body .alert[data-status=…]` overrides in
`src/app.css`) — delete it once the library lands this.
