# MTUI bug report: anchored menus jump to the opposite edge in RTL

## Problem

`js/menu.js` anchors a `.menu[popover]` under its `[popovertarget]` trigger
by writing three inline properties:

```js
menu.style.position = 'fixed';
menu.style.top = `${Math.round(top)}px`;
menu.style.left = `${Math.round(x)}px`;
menu.style.margin = '0';
```

It never touches `right`. The UA stylesheet for `[popover]` sets `inset: 0`
plus `width: fit-content`, so after the script runs the box has a definite
width **and** both `left` and `right` resolved — an over-constrained
absolutely positioned box. CSS 2.1 §10.3.7 breaks that tie by direction:
`right` loses in LTR, and **`left` loses in RTL**.

So the script's carefully computed `left` is discarded in an Arabic (or any
`dir="rtl"`) document and the leftover `right: 0` pins the panel to the
inline-end edge of the viewport. The RTL branch in `place()`

```js
let x = rtl ? t.right - m.width : t.left;
```

computes the correct value and it is silently thrown away. Measured in
mp3fy at 420px wide, a trigger at the top inline-start corner:

| | computed `left` | actual `left` |
|---|---|---|
| written by menu.js | `8px` | — |
| after layout | — | `249px` (flush right) |

Setting `right: auto` on the panel restores it to `8px`.

Everything that ships a copy of the anchoring block is affected the same
way: `js/menu.js`, `js/x-select.js`, `js/x-datepicker.js`,
`js/x-colorswatches.js`, and the panel `js/x-contextmenu.js` positions by
hand.

## Fix

Clear the edges the script is not driving, in `place()`:

```js
menu.style.position = 'fixed';
menu.style.top = `${Math.round(top)}px`;
menu.style.left = `${Math.round(x)}px`;
menu.style.right = 'auto';
menu.style.bottom = 'auto';
menu.style.margin = '0';
```

`bottom` is not currently broken (the vertical over-constraint drops
`bottom`, which is the edge the script ignores anyway) but clearing it makes
the intent explicit and immune to the same class of surprise.

Keep the copies in the enhanced-input scripts identical, per the note at the
top of `js/menu.js`.

## Workaround in this app

`src/app.css` §7:

```css
html[dir='rtl'] .menu[popover] {
	right: auto;
}
```

Scoped to RTL so LTR keeps MTUI's own behaviour untouched. Safe here because
mp3fy is a SvelteKit app — the no-JS fallback the UA centering exists for
(`.menu[popover] { margin: auto }`) never applies; if JS is off nothing
renders at all. A library-level fix should stay in `place()` rather than CSS
for exactly that reason.
