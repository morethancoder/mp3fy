# MTUI upgrade request: bottom tab bar as a first-class, default shell nav

## Problem

MTUI's `.shell` frame hardcodes its nav placement: a bottom tab bar below
768px, then a 5rem inline-start side rail at ≥768px (`css/layout.css`, the
`@media (min-width: 768px)` block near line 91 that rewrites
`grid-template-areas` and turns `.shell-nav` into a column). There is **no
knob to choose** — nav placement is the one appearance decision the library
does not expose as a `data-*` attribute on `<html>` (theme, accent, radius,
density, tint all have one).

Apps with 2–4 destinations (transcribe, mp3fy) want the bottom tab bar at
**every** width — it is the more familiar pattern and keeps desktop and
mobile identical. Today each app must copy a block of override CSS
(`body.shell` specificity hack + a media query undoing yours), which MTUI's
own guide forbids ("app code never writes layout CSS or media queries").
Two apps have now shipped the same ~80-line override; that is the signal
this belongs in the library.

## Requested change

1. **Add a nav-placement knob on `<html>`, consistent with the other knobs:**

   ```
   data-nav: bar | rail
   ```

   - `bar` — bottom tab bar at every viewport width (grid areas
     `header / content / nav`, rows `auto 1fr auto`, `.shell-nav` stays
     `flex-direction: row`).
   - `rail` — current responsive behavior (bar <768px, side rail ≥768px).
   - **Default: `bar`.** Downstream note: this flips today's ≥768px default;
     apps that want the rail must opt in with `data-nav="rail"`. Both known
     consumers already override to the bar, so the break is theoretical —
     but call it out in the changelog.

2. **Make the tab items visibly pressable (stock, not per-app CSS).** Today
   items are only as wide as their label (~64px) in a `space-evenly` row —
   most of the bar is dead space with no hint where the target ends. Adopt
   what transcribe/mp3fy ship (all tones already in the system):

   - items `flex: 1 1 0`, capped so N tabs + gaps align with the 40rem
     content column of `screen-stack`;
   - resting `background: var(--surface-2)`, hover `var(--surface-3)`
     (the `background-color` transition on `.shell-nav > *` already exists,
     it just never fires because no background is set);
   - current tab (`[aria-current]`): `background: var(--accent-tint)`,
     `color: var(--accent-text)` — mirrors `.chip[aria-pressed="true"]`;
   - bar padding `var(--sp-8)` block / `var(--pad)` inline, plus
     `env(safe-area-inset-bottom)` on the block-end.

3. **Quiet mobile bar.** Below 768px the bar should read calmer: every tab
   keeps its icon + label, but resting tabs drop the tonal background —
   only the current tab wears the accent pill (`--accent-tint`). mp3fy
   ships exactly this as an app-side override — fold it in as the stock
   small-screen treatment of the `bar` mode.

4. **Safe areas / short viewports** (independent of the knob, same fix
   family):
   - `.screen-stack` inline padding should clear display cutouts in
     landscape: `max(var(--pad), env(safe-area-inset-left), …)` — the idiom
     `.screen-center` already uses (layout.css ~192) but `.screen-stack`
     lacks.
   - Below 480px viewport height, tighten `.shell-nav` and `.screen-stack`
     block padding one step (`--sp-4` / `--sp-8`) so landscape phones keep
     more than a line of content visible.

5. **Docs:** add `data-nav` to the theming section of `llms.txt` and
   `DESIGN.md` (valid values, default, and that `<x-theme>` does NOT control
   it — it's a product decision, not a user preference).

6. **Forced-colors:** layout.css already gives `.shell-nav` a
   `border-block-start` in forced-colors mode and swaps it for an inline-end
   border when it becomes a rail — keep the bar variant on the block-start
   border at every width.

## Reference implementation

The exact override CSS both apps ship today (delete from the apps once the
library lands this): `transcribe/src/app.css` and `mp3fy/src/app.css` —
sections 1–4 map one-to-one onto items 1–3 above. Adapt selectors from
`body.shell …` back to `.shell …`; the apps only needed the extra
specificity to beat the stylesheet they were overriding.

## Acceptance

- Fresh page with no `data-nav`: bottom tab bar at 1280px wide, items fill
  the bar up to the content-column cap, current tab tinted with
  `--accent-tint`/`--accent-text`.
- `data-nav="rail"`: today's behavior, pixel-identical.
- No app-side CSS needed for either mode; transcribe's and mp3fy's
  `app.css` overrides become deletable with no visual change (bar mode).
- `x-theme` panel untouched. RTL: bar order follows document direction;
  rail stays inline-start.
