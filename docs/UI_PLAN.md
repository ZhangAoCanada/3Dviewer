# UI redesign plan

## Status

Batches 1, 2, and 3 are implemented.

Still needs a check on a real iPhone or iPad:

- iPhone: home-indicator clearance under the sheet (`safe-area-inset-bottom` is 0 in headless Chrome), the `black-translucent` status bar, and the full-screen button staying hidden (`fullscreenEnabled` is false in Safari).
- iPad: the 1024×1366 portrait shots are from touch emulation, not hardware.
- Camera flights in `src/render` still run under reduced motion. Left as a follow-up.

Base: `main` at `293e8f8` (after audit batch 5).
Scope: `index.html`, `src/styles.css`, `src/main.ts`, `src/app/ViewerApp.ts`, `src/app/registerUpdate.ts`,
new files under `src/ui/`, and one new Playwright spec. Nothing under `src/render`, `src/loaders`, `src/core`,
`src/workers`, `src/streaming`, or `src/renderables` changes.

The implementer should follow this file literally. Where a value is given, use that value. Where a choice
is left open, it says so.

---

## 0. What is wrong today (evidence)

Screenshots of `main` were taken at 1280x800 and 390x844 in headless Chrome (dark theme, `?sample=torus-ply`).

1. **Top bar.** Eight text buttons have the same visual weight ("Open", "Samples", "Orbit", "Fly", "Reset",
   "Theme", "Panel"). At 390 px the bar wraps to three rows and covers about 19% of the screen.
2. **Settings panel.** It opens by default and takes about 25% of the desktop width. It is one flat list of 14
   controls, and it shows controls that do nothing for the loaded kind (Point size for splats, Wireframe and
   Shading for splats). The camera-controls help is a bullet list at the bottom of the panel.
3. **HUD.** Six fixed cells in uppercase mono, always visible, including zeros ("Points 0", "Tris 0").
   It has `aria-live="polite"`, so screen readers announce it every 0.4 s.
4. **No way to open a URL from the UI**, even though `?url=` works.
5. **Loading.** One bar, no stages, no cancel, no elapsed time. A multi-minute 3.5 GB load gives no sense of
   progress. `setLoading` formats byte counts with `formatCount` (for example "1,234,567,890 / 3,758,096,384").
   In the GPU stage, `loaded/total` is splats kept over source splats, so a subsampled scene shows a stuck
   "71%".
6. **Toasts.** Information such as "Nothing under the center of the view to focus." uses the red error style.
   There is no dismiss button, and the toast sits at bottom center on top of the nav hint.
7. **Georeference**, the main use case, shows up only as raw `epsg`, `offset`, `bounds` rows in the Scene table.
8. **Nav hint** is permanent and mouse-only ("Right-drag pan", "Scroll") even on phones.
9. **Accessibility.** There are no `:focus-visible` styles (the canvas has `outline: none`), the Orbit/Fly
   segment has no `aria-pressed`, and button labels like "Panel" and "Theme" are vague.
10. **Drop feedback** is a dashed outline. The empty state is almost never seen, because a bare URL auto-loads
    the torus.
11. **Update prompt** sits bottom-right, under the settings panel.

---

## 1. Design direction

**Canvas first, chrome on demand.** The scan fills the screen. All UI floats over it as small glass
"islands" with generous gaps, so the scene shows through between them. This follows SuperSplat and
Google Earth web, not a full-width app header.

- **Top-left island:** brand mark, then a *file chip* (kind badge, file name, size, EPSG badge).
- **Top-right island:** Open (primary), Open URL, Samples, Theme, Help, Settings. Icons only below 900 px.
- **Bottom-center island (toolbar):** Orbit | Fly segment, Focus, Reset view, Full screen. This is the
  thumb zone on phones.
- **Right drawer (desktop/tablet) or bottom sheet (phone):** settings, closed by default.
- **Top-left under the brand:** a one-line stats pill that expands on click.
- **Bottom-center above the toolbar:** a stack of toasts and the update prompt.

**Visual language.** Neutral graphite surfaces (not blue-tinted), one teal accent kept from the current
brand, hairline borders, 14 px island radius with concentric 10 px controls inside, a soft two-layer
shadow, and 16 px backdrop blur. Lucide-style 1.75 px stroke icons. Type is DM Sans 400 and 600 only,
with tabular numerals for all numbers. Sentence-case headings, with no uppercase letter-spaced labels.
Motion is 120 to 200 ms ease-out fades and slides, and all of it is disabled under reduced motion.

### Layout maps

```
Desktop 1280x800 (panel open)
┌──────────────────────────────────────────────────────────────────────────────┐
│ [● 3Dviewer │ Splats  drone_scan.ply  3.5 GB  ⌖EPSG:32617]   [Open][🔗][◇ Samples ▾]│[☀][?][⚙]│
│ [60 fps · 14.0M splats · 2.1 GB]                                ┌─ Settings ──── ✕ ┐│
│                                                                 │ ▾ Scene          ││
│                          (scene)                                │ ▾ Georeference   ││
│                                                                 │ ▾ Display        ││
│                                                                 │ ▸ View & nav     ││
│                 ┌ toast stack ┐                                 │ ▸ Performance    ││
│                 [⟳ Orbit | ✈ Fly │ ⌖ │ ⌂ │ ⛶ ]                  │ ▸ Advanced       ││
└──────────────────────────────────────────────────────────────────└──────────────────┘┘

Phone 390x844
┌──────────────────────────────┐
│[●│Splats drone_s…] [📂][⚙][⋯]│  ← safe-area-inset-top
│[60 fps · 14.0M]              │  (stats pill only if enabled)
│                              │
│           (scene)            │
│                              │
│        ┌ toast stack ┐       │
│ [ ⟳ Orbit | ✈ Fly │ ⌖ │ ⌂ ]  │  ← safe-area-inset-bottom + 8 px
└──────────────────────────────┘
Settings open on phone → bottom sheet, max 70dvh, the top 30% of the scene stays visible.
```

---

## 2. Design tokens (replace the `:root` blocks at the top of `src/styles.css`)

Copy this verbatim. Every other rule in the stylesheet must use these variables, with no raw colors except
inside these blocks. The old variable names (`--bg`, `--elev`, `--line`, `--muted`, `--accent`, and so on)
are removed. Update every use.

```css
:root {
  color-scheme: dark;

  /* Color: dark (default) */
  --color-bg: #0c0f14;
  --color-canvas: #10141b;
  --color-surface: rgba(20, 23, 30, 0.78);
  --color-surface-solid: #161a21;
  --color-surface-2: #1e232c;
  --color-hover: rgba(255, 255, 255, 0.06);
  --color-active: rgba(255, 255, 255, 0.1);
  --color-border: rgba(255, 255, 255, 0.08);
  --color-border-strong: rgba(255, 255, 255, 0.16);
  --color-text: #eceff4;
  --color-text-muted: #a1a8b5;
  --color-text-subtle: #7c8492;
  --color-accent: #5eead4;
  --color-accent-hover: #99f6e4;
  --color-on-accent: #04201c;
  --color-accent-soft: rgba(94, 234, 212, 0.14);
  --color-accent-text: #5eead4;
  --color-focus: #5eead4;
  --color-track: #646a75;
  --color-thumb: #ffffff;
  --color-danger: #f87171;
  --color-danger-soft: rgba(248, 113, 113, 0.14);
  --color-warning: #fbbf24;
  --color-warning-soft: rgba(251, 191, 36, 0.14);
  --color-success: #4ade80;
  --color-info: #93c5fd;
  --color-scrim: rgba(5, 7, 10, 0.55);

  /* Elevation */
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.24);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.28), 0 1px 2px rgba(0, 0, 0, 0.2);
  --shadow-lg: 0 16px 40px rgba(0, 0, 0, 0.4), 0 2px 6px rgba(0, 0, 0, 0.24);
  --blur: blur(16px) saturate(160%);

  /* Spacing (4 px grid) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;
  --radius-full: 999px;

  /* Type */
  --font-sans: 'DM Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace;
  --text-xs: 11px;   --leading-xs: 14px;
  --text-sm: 12px;   --leading-sm: 16px;
  --text-base: 13px; --leading-base: 18px;
  --text-md: 14px;   --leading-md: 20px;
  --text-lg: 16px;   --leading-lg: 22px;
  --text-xl: 24px;   --leading-xl: 30px;
  --weight-regular: 400;
  --weight-semibold: 600;
  --tracking-tight: -0.02em;

  /* Controls and layout */
  --control-h: 32px;
  --control-h-sm: 28px;
  --control-h-lg: 40px;
  --icon-size: 18px;
  --icon-sm: 16px;
  --icon-xl: 28px;
  --cluster-pad: 4px;
  --inset: 12px;
  --gap: 8px;
  --island-h: calc(var(--control-h) + 2 * var(--cluster-pad));
  --panel-w: 320px;
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);

  /* Motion */
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1);
  --dur-fast: 120ms;
  --dur-base: 200ms;
  --dur-slow: 320ms;

  /* Stacking (dialogs use the browser top layer) */
  --z-hud: 4;
  --z-toolbar: 5;
  --z-topbar: 6;
  --z-panel: 7;
  --z-loading: 8;
  --z-toast: 9;
  --z-drop: 10;
}

:root[data-theme='light'] {
  color-scheme: light;
  --color-bg: #f3f5f8;
  --color-canvas: #e7ebf1;
  --color-surface: rgba(255, 255, 255, 0.82);
  --color-surface-solid: #ffffff;
  --color-surface-2: #f2f4f7;
  --color-hover: rgba(15, 23, 42, 0.05);
  --color-active: rgba(15, 23, 42, 0.09);
  --color-border: rgba(15, 23, 42, 0.1);
  --color-border-strong: rgba(15, 23, 42, 0.2);
  --color-text: #0f172a;
  --color-text-muted: #475569;
  --color-text-subtle: #64748b;
  --color-accent: #0f766e;
  --color-accent-hover: #115e59;
  --color-on-accent: #ffffff;
  --color-accent-soft: rgba(15, 118, 110, 0.1);
  --color-accent-text: #0f766e;
  --color-focus: #0f766e;
  --color-track: #8a919c;
  --color-thumb: #ffffff;
  --color-danger: #b91c1c;
  --color-danger-soft: rgba(185, 28, 28, 0.08);
  --color-warning: #b45309;
  --color-warning-soft: rgba(180, 83, 9, 0.1);
  --color-success: #15803d;
  --color-info: #1d4ed8;
  --color-scrim: rgba(15, 23, 42, 0.32);
  --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.06);
  --shadow-md: 0 4px 12px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.06);
  --shadow-lg: 0 16px 40px rgba(15, 23, 42, 0.14), 0 2px 6px rgba(15, 23, 42, 0.06);
}

@media (pointer: coarse) {
  :root {
    --control-h: 44px;
    --control-h-sm: 36px;
    --control-h-lg: 48px;
    --icon-size: 20px;
    --radius-md: 12px;
    --radius-lg: 16px;
  }
}

@media (max-width: 640px) {
  :root { --inset: 8px; }
}

@media (prefers-reduced-motion: reduce) {
  :root { --dur-fast: 0ms; --dur-base: 0ms; --dur-slow: 0ms; }
}
```

`--color-bg` and `--color-canvas` keep today's values, so `ViewerApp.canvasColor()` (`#10141b` / `#e7ebf1`),
the `theme-color` meta values (`#0c0f14` / `#f3f5f8`), and the PWA manifest stay correct without changes.

Contrast (WCAG 2.x formula) against `--color-surface-solid` (`#161a21` dark, `#ffffff` light):

| Pair | Dark | Light |
| --- | --- | --- |
| text | 15.1:1 | 17.9:1 |
| text-muted | 7.3:1 | 7.6:1 |
| text-subtle (secondary metadata only) | 4.6:1 | 4.8:1 |
| accent-text | 11.8:1 | 5.5:1 |
| on-accent on accent | 11.6:1 | 5.5:1 |
| danger | 6.3:1 | 6.5:1 |
| warning | 10.4:1 | 5.0:1 |
| track (non-text, needs 3:1) | 3.2:1 | 3.2:1 |

---

## 3. Information architecture

| Tier | Where | Contents |
| --- | --- | --- |
| Always visible | Top-left island | Brand mark, file chip: kind badge, name, size, EPSG badge if georeferenced |
| Always visible | Top-right island | Open (primary), Open URL, Samples, Theme, Help, Settings. On phone: Open, Settings, and More (⋯) |
| Always visible | Bottom toolbar | Orbit / Fly, Focus center, Reset view, Full screen (only where supported) |
| Glanceable, optional | Stats pill | fps, primary count, GPU estimate. Expands to a detail list. On by default on desktop, off on phone |
| Transient | Toast stack | Errors, warnings, info, update prompt |
| Transient | Nav hint | First visit only, until the first canvas interaction or 8 s |
| On demand | Settings drawer or sheet | Sections below |
| On demand | Dialogs | Open from URL; Controls and shortcuts |
| Advanced | Settings, Advanced section (collapsed) | 2D Gaussian axes, Radial depth sort, Extended precision, format explanation |

Settings sections, in order. `[open]` means expanded by default. "Applies" sets `data-applies`
(section 4.7):

1. **Scene** `[open]`: `#scene-info`. The rows are listed in Batch 2, task 2.7.
2. **Georeference** `[open]`, hidden when there is no georef: CRS, Offset, Bounds, Copy, epsg.io.
3. **Display** `[open]`: SH degree (splats), Splat cutoff (splats), Point size (points), Shading (mesh),
   Wireframe (mesh), Ground grid (all).
4. **View and navigation**: Up axis, Flip Y (OpenCV / COLMAP), Sensitivity.
5. **Performance**: LOD detail (splats), Pixel ratio, Show stats overlay (new), `#perf-info`.
6. **Advanced**: 2D Gaussian axes (splats), Radial depth sort (splats), Extended precision on next load
   (splats), and the "Large Gaussian PLY…" hint text.
7. **About**: Build `#build-id`, a GitHub link (`https://github.com/ZhangAoCanada/3Dviewer`), and the
   Lucide licence line.
8. *(Batch 1 only, removed in Batch 2)* **Controls**: the existing `.help` list.

---

## 4. Component specs

All DOM below is the target markup for `index.html`. IDs marked **(keep)** already exist and are bound by
`must()` or `registerUpdate`; they must survive with the same element type. IDs marked **(new)** are new.

### 4.1 Icons: inline SVG sprite (Lucide, ISC)

- Put a single `<svg class="sprite" aria-hidden="true" focusable="false">…</svg>` as the first child of `<body>`.
  Add `.sprite { position: absolute; width: 0; height: 0; overflow: hidden; }`. Do not use
  `display: none`.
- Each icon is `<symbol id="i-NAME" viewBox="0 0 24 24">…children…</symbol>`. Use
  `<svg class="icon" aria-hidden="true"><use href="#i-NAME"/></svg>`.
- CSS:
  `.icon { width: var(--icon-size); height: var(--icon-size); flex: none; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; }`
  `.icon-sm { width: var(--icon-sm); height: var(--icon-sm); }`
  `.icon-xl { width: var(--icon-xl); height: var(--icon-xl); stroke-width: 1.5; }`
- The set (30): `folder-open link shapes upload rotate-3d plane focus house maximize minimize sun moon
  circle-help sliders-horizontal ellipsis x chevron-down check circle-alert triangle-alert info circle-check
  refresh-cw map-pin copy activity external-link mouse hand keyboard`.
- To generate the symbols, do not add a dependency. Run:

```bash
cd /tmp && npm pack lucide-static@latest && tar xzf lucide-static-*.tgz
node -e "const fs=require('fs');const n='folder-open link shapes upload rotate-3d plane focus house maximize minimize sun moon circle-help sliders-horizontal ellipsis x chevron-down check circle-alert triangle-alert info circle-check refresh-cw map-pin copy activity external-link mouse hand keyboard'.split(' ');console.log(n.map(x=>{const s=fs.readFileSync('/tmp/package/icons/'+x+'.svg','utf8');const inner=s.replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,'').trim().replace(/\s*\n\s*/g,'');return '<symbol id=\"i-'+x+'\" viewBox=\"0 0 24 24\">'+inner+'</symbol>'}).join('\n'))"
```

  Paste the output inside the sprite. Put `<!-- Icons: Lucide (https://lucide.dev), ISC License -->`
  directly above it. If an icon name has been renamed upstream, use the current Lucide name and keep
  the `i-` id from this list.

### 4.2 Base, buttons, segment

- `body`: `font: var(--weight-regular) var(--text-md)/var(--leading-md) var(--font-sans); -webkit-font-smoothing: antialiased; font-variant-numeric: tabular-nums;`
- `.island` (new utility, used by `.brand`, `.top-actions`, `.toolbar`, `.hud`):
  `display: flex; align-items: center; gap: var(--space-1); padding: var(--cluster-pad); min-height: var(--island-h); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); backdrop-filter: var(--blur); -webkit-backdrop-filter: var(--blur); box-shadow: var(--shadow-md);`
- `.btn`: `display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: var(--control-h); padding: 0 var(--space-3); border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: var(--color-text); font-size: var(--text-md); line-height: 1; white-space: nowrap; transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast), color var(--dur-fast);`
  - `.btn-primary`: `background: var(--color-accent); color: var(--color-on-accent); font-weight: var(--weight-semibold);` with `:hover { background: var(--color-accent-hover); }`.
  - `.btn-secondary`: `background: var(--color-surface-2); border-color: var(--color-border);` with `:hover { border-color: var(--color-border-strong); }`.
  - `.btn-ghost:hover { background: var(--color-hover); }`, and `:active { background: var(--color-active); }`.
  - `.btn-icon`: `width: var(--control-h); padding: 0;`
  - `.btn-sm`: `height: var(--control-h-sm); padding: 0 10px; font-size: var(--text-sm);` and with `.btn-icon`, `width: var(--control-h-sm)`.
  - `.btn-lg`: `height: var(--control-h-lg); padding: 0 18px;`
  - `.btn:disabled { opacity: 0.45; cursor: not-allowed; }`
  - `.btn[aria-expanded='true']`, `.btn[aria-pressed='true']`: `background: var(--color-accent-soft); color: var(--color-accent-text);`
- `.divider`: `width: 1px; align-self: stretch; margin: 6px 2px; background: var(--color-border);`
- `.segment`: `display: inline-flex; gap: 2px; padding: 2px; border-radius: var(--radius-md); background: var(--color-hover);`
  `.seg`: same as `.btn` with `height: calc(var(--control-h) - 4px); border-radius: calc(var(--radius-md) - 2px);`
  `.seg.is-on, .seg[aria-pressed='true']`: `background: var(--color-surface-solid); box-shadow: var(--shadow-sm); color: var(--color-text);` and `.seg.is-on .icon { color: var(--color-accent-text); }`
- Focus: `:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }` and
  `#view:focus-visible { outline: 2px solid var(--color-focus); outline-offset: -2px; }`.
  Remove `outline: none` from `#view`; mouse clicks do not trigger `:focus-visible`.
- `.sr-only`: the standard visually-hidden rule (1 px clip).
- Responsive labels: `.btn-label`, `.seg-label`. At `@media (max-width: 900px)`, hide `.top-actions .btn-label`
  except inside `#open-btn`. At `@media (max-width: 640px)`, also hide `#open-btn .btn-label`. Keep
  `.seg-label` visible at every width (Orbit and Fly need words).

### 4.3 Top bar (top-left and top-right islands)

```html
<header class="topbar">
  <div class="brand island">
    <span class="mark" aria-hidden="true"></span>
    <span class="brand-name">3Dviewer</span>
    <div id="file-chip" class="file-chip" hidden>                       <!-- new -->
      <span class="divider" aria-hidden="true"></span>
      <span id="file-kind" class="badge">Splats</span>                  <!-- new -->
      <span id="file-name" class="file-name"></span>                    <!-- new -->
      <span id="file-size" class="file-size"></span>                    <!-- new -->
      <button id="geo-badge" class="badge badge-geo" type="button" hidden aria-label="Show georeference">  <!-- new, batch 2 -->
        <svg class="icon icon-sm" aria-hidden="true"><use href="#i-map-pin"/></svg><span id="geo-badge-text"></span>
      </button>
    </div>
  </div>
  <div class="top-actions island">
    <button id="open-btn" class="btn btn-primary" type="button" title="Open file (O)">        <!-- keep -->
      <svg class="icon" aria-hidden="true"><use href="#i-folder-open"/></svg><span class="btn-label">Open</span>
    </button>
    <input id="file-input" type="file" hidden accept="…unchanged…" />                         <!-- keep -->
    <button id="url-btn" class="btn btn-ghost btn-icon hide-phone" type="button" aria-label="Open from URL" title="Open from URL (U)">  <!-- new, batch 2 -->
      <svg class="icon" aria-hidden="true"><use href="#i-link"/></svg>
    </button>
    <div class="menu hide-phone">
      <button id="samples-btn" class="btn btn-ghost" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="samples-menu">  <!-- keep -->
        <svg class="icon" aria-hidden="true"><use href="#i-shapes"/></svg><span class="btn-label">Samples</span>
        <svg class="icon icon-sm btn-label" aria-hidden="true"><use href="#i-chevron-down"/></svg>
      </button>
      <div id="samples-menu" class="menu-pop" role="menu" aria-label="Samples" hidden></div>   <!-- keep -->
    </div>
    <span class="divider hide-phone" aria-hidden="true"></span>
    <button id="theme-btn" class="btn btn-ghost btn-icon hide-phone" type="button" aria-label="Switch to light theme" title="Theme (T)">  <!-- keep -->
      <svg class="icon only-dark" aria-hidden="true"><use href="#i-sun"/></svg>
      <svg class="icon only-light" aria-hidden="true"><use href="#i-moon"/></svg>
    </button>
    <button id="help-btn" class="btn btn-ghost btn-icon hide-phone" type="button" aria-haspopup="dialog" aria-label="Controls and shortcuts" title="Controls and shortcuts (?)">  <!-- new, batch 2 -->
      <svg class="icon" aria-hidden="true"><use href="#i-circle-help"/></svg>
    </button>
    <button id="panel-btn" class="btn btn-ghost btn-icon" type="button" aria-label="Settings" title="Settings (H)" aria-expanded="false" aria-controls="panel">  <!-- keep -->
      <svg class="icon" aria-hidden="true"><use href="#i-sliders-horizontal"/></svg>
    </button>
    <!-- batch 3: #more-btn + #more-menu (section 4.13) -->
  </div>
</header>
```

- `.topbar`: `position: absolute; z-index: var(--z-topbar); top: calc(var(--safe-top) + var(--inset)); left: calc(var(--safe-left) + var(--inset)); right: calc(var(--safe-right) + var(--inset)); display: flex; justify-content: space-between; align-items: flex-start; gap: var(--gap); pointer-events: none;`
  and `.topbar > * { pointer-events: auto; }`.
- `.brand`: `min-width: 0; padding-inline: 10px var(--cluster-pad); gap: var(--space-2);`. Use `.mark` at 20 px.
  `.brand-name`: `font-weight: 600; letter-spacing: var(--tracking-tight);`. Hide it at ≤640 px and whenever
  `#file-chip` is visible at ≤900 px (`.brand:has(#file-chip:not([hidden])) .brand-name`). In the same case,
  drop the first divider.
- `.file-chip`: `display: flex; align-items: center; gap: var(--space-2); min-width: 0;`
  `.file-name`: `max-width: 32ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-base);`
  plus `title` set to the full name. At ≤640 px, `max-width: none; flex: 1 1 auto`.
  `.file-size`: `color: var(--color-text-muted); font-size: var(--text-sm);`. Hide it at ≤640 px.
- `.badge`: `display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 6px; border-radius: var(--radius-sm); background: var(--color-accent-soft); color: var(--color-accent-text); font-size: var(--text-xs); font-weight: 600;`
  `.badge-geo` is a button: add `border: 0; cursor: pointer;` and `:hover { background: var(--color-active); }`.
- `.only-dark` shows in dark and `.only-light` shows in light: `:root[data-theme='light'] .only-dark, :root:not([data-theme='light']) .only-light { display: none; }`.
  `toggleTheme()` sets `#theme-btn`'s `aria-label` to "Switch to light theme" or "Switch to dark theme".
  Do this once at boot as well.
- `.hide-phone`: `@media (max-width: 640px) { display: none !important; }`. `.show-phone` is the inverse.
- Remove `.brand-sub` and its markup.

### 4.4 Bottom toolbar

```html
<nav id="toolbar" class="toolbar island" aria-label="View controls">                               <!-- new -->
  <div class="segment" role="group" aria-label="Navigation mode">
    <button id="mode-orbit" class="seg is-on" type="button" aria-pressed="true" title="Orbit (1)">   <!-- keep -->
      <svg class="icon" aria-hidden="true"><use href="#i-rotate-3d"/></svg><span class="seg-label">Orbit</span>
    </button>
    <button id="mode-fly" class="seg" type="button" aria-pressed="false" title="Fly (2)">            <!-- keep -->
      <svg class="icon" aria-hidden="true"><use href="#i-plane"/></svg><span class="seg-label">Fly</span>
    </button>
  </div>
  <span class="divider" aria-hidden="true"></span>
  <button id="focus-btn" class="btn btn-ghost btn-icon" type="button" aria-label="Focus the center point" title="Focus the center (F)">  <!-- new -->
    <svg class="icon" aria-hidden="true"><use href="#i-focus"/></svg>
  </button>
  <button id="reset-btn" class="btn btn-ghost btn-icon" type="button" aria-label="Reset view" title="Reset view (R)">  <!-- keep -->
    <svg class="icon" aria-hidden="true"><use href="#i-house"/></svg>
  </button>
  <button id="fullscreen-btn" class="btn btn-ghost btn-icon" type="button" aria-label="Enter full screen" title="Full screen" hidden>  <!-- new -->
    <svg class="icon when-windowed" aria-hidden="true"><use href="#i-maximize"/></svg>
    <svg class="icon when-fullscreen" aria-hidden="true"><use href="#i-minimize"/></svg>
  </button>
</nav>
```

- Place the toolbar as a sibling after `<header>`, not inside it. `backdrop-filter` on an ancestor would trap
  fixed and absolute positioning.
- `.toolbar`: `position: absolute; z-index: var(--z-toolbar); left: 50%; bottom: calc(var(--safe-bottom) + var(--inset)); transform: translateX(-50%);`
  At ≥641 px, add `body.panel-open .toolbar { left: calc((100% - var(--panel-w) - var(--inset)) / 2); }`.
- `focus-btn` calls a new `private focusCenter()`. Move the body of the current `KeyF` branch into it,
  unchanged except that the toast becomes `'info'`. The `KeyF` handler then calls `focusCenter()`.
- `fullscreen-btn`: `hidden = !document.fullscreenEnabled`. On click, call
  `document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()`.
  On `fullscreenchange`, toggle `body.is-fullscreen` and set the label to "Exit full screen" or
  "Enter full screen". CSS: `body:not(.is-fullscreen) .when-fullscreen, body.is-fullscreen .when-windowed { display: none; }`.
  On iPhone Safari, `fullscreenEnabled` is false and the button stays hidden. That is intended.
- `setMode()`: in addition to the `is-on` toggles, set `aria-pressed` to `'true'`/`'false'` on both buttons.

### 4.5 Stats HUD (compact pill plus an expandable detail)

```html
<section id="hud" class="hud island" aria-label="Performance stats">     <!-- keep id; REMOVE aria-live -->
  <button id="hud-toggle" class="hud-summary" type="button" aria-expanded="false" aria-controls="hud-detail" title="Stats (I)">  <!-- new -->
    <svg class="icon icon-sm" aria-hidden="true"><use href="#i-activity"/></svg>
    <span><strong id="hud-fps">—</strong> <span class="hud-unit">fps</span></span>   <!-- keep #hud-fps -->
    <span class="hud-dot" aria-hidden="true">·</span>
    <span id="hud-summary-count">—</span>                                              <!-- new -->
    <span class="hud-dot" aria-hidden="true">·</span>
    <span id="hud-summary-gpu">—</span>                                                <!-- new -->
  </button>
  <dl id="hud-detail" class="hud-detail" hidden>                                       <!-- new -->
    <div><dt>Frame</dt><dd id="hud-ms">—</dd></div>                                    <!-- keep -->
    <div data-hud-row="splats"><dt>Splats</dt><dd id="hud-splats">—</dd></div>         <!-- keep -->
    <div data-hud-row="points"><dt>Points</dt><dd id="hud-points">—</dd></div>         <!-- keep -->
    <div data-hud-row="tris"><dt>Triangles</dt><dd id="hud-tris">—</dd></div>          <!-- keep -->
    <div><dt>GPU est.</dt><dd id="hud-gpu">—</dd></div>                                <!-- keep -->
  </dl>
</section>
```

- **E2E contract:** `#hud-splats`, `#hud-points` and `#hud-tris` must keep receiving
  `formatCount(...)` (full, comma-grouped) exactly as today. `tests-e2e/smoke.spec.ts` parses them.
  The rows stay in the DOM even while `#hud-detail` is hidden.
- Position: `position: absolute; z-index: var(--z-hud); top: calc(var(--safe-top) + var(--inset) + var(--island-h) + var(--gap)); left: calc(var(--safe-left) + var(--inset)); flex-direction: column; align-items: stretch; min-height: 0; padding: 2px; font-size: var(--text-sm);`
- `.hud-summary`: `display: flex; align-items: center; gap: 6px; height: var(--control-h-sm); padding: 0 10px; border: 0; background: transparent; border-radius: var(--radius-md); color: var(--color-text);`. On hover, use `--color-hover`.
  `.hud-unit`, `.hud-dot`: `color: var(--color-text-muted)`.
- `.hud-detail`: `display: grid; grid-template-columns: auto auto; gap: 4px 16px; margin: 0; padding: 6px 10px 8px;`.
  `div { display: contents; }`, `dt { color: var(--color-text-muted); }`, `dd { margin: 0; text-align: right; }`.
- In `renderPerf`, keep the five existing writes. Then:
  - When `stats.idle`, set `#hud-fps` to `Idle` and add `#hud.is-idle`; CSS hides `.hud-unit` there.
  - Hide each `[data-hud-row]` whose count is 0 (`row.hidden = value === 0`).
  - `#hud-summary-count`: if splats > 0, `${formatCompact(shownSplats)} splats`. Otherwise, if points > 0,
    `${formatCompact(points)} points`. Otherwise, if tris > 0, `${formatCompact(tris)} tris`. Otherwise `—`.
  - `#hud-summary-gpu` = `formatBytes(stats.gpuMemoryBytes)`.
  - Rebuild `#perf-info` only when the panel is open (`!#panel.classList.contains('is-collapsed')`).
    `onFrame` already fires only every 0.4 s, so no extra throttling is needed.
- Add `formatCompact(value)` to `src/ui/format.ts`. Return `'—'` for non-finite values, `String(Math.round(v))`
  below 1,000, `(v/1e3).toFixed(v < 1e4 ? 1 : 0) + 'K'` below 1e6, `(v/1e6).toFixed(v < 1e7 ? 2 : 1) + 'M'`
  below 1e9, and otherwise `(v/1e9).toFixed(2) + 'B'`. Add unit tests in `tests/format.test.ts`:
  999 → "999", 4800 → "4.8K", 14_000_000 → "14.0M", 3_500_000 → "3.50M".
- Visibility: new key `3dviewer-hud` (`'on'` | `'off'`). The default is `'on'` when
  `matchMedia('(min-width: 641px)').matches`, otherwise `'off'`. It is applied as `#hud.hidden`.
  Toggle it from the new switch `#hud-switch` (Performance section) and the `I` key (Batch 3).
  Write it with `writeStorage`.
- `#hud-toggle` click: toggle `#hud-detail.hidden` and `aria-expanded`.

### 4.6 Form controls

- **Select** (wrap all five: `#sh-degree`, `#shading`, `#pixel-ratio`, `#up-axis`, and nothing else):
  `<span class="select"><select id="…">…unchanged options…</select><svg class="icon icon-sm" aria-hidden="true"><use href="#i-chevron-down"/></svg></span>`
  `.select { position: relative; display: inline-flex; }`
  `.select select { appearance: none; height: var(--control-h); min-width: 132px; padding: 0 30px 0 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface-2); color: var(--color-text); font-size: var(--text-base); }`
  `.select .icon { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--color-text-muted); }`
  At `@media (pointer: coarse)`, use `font-size: 16px` so iOS does not zoom on focus.
- **Range** (all four: `#splat-scale`, `#point-size`, `#lod-scale`, `#sensitivity`; min, max, step and value unchanged):

```css
input[type='range'] { -webkit-appearance: none; appearance: none; width: 100%; height: 20px; margin: 0; background: transparent; --fill: 50%; }
input[type='range']::-webkit-slider-runnable-track { height: 4px; border-radius: var(--radius-full); background: linear-gradient(to right, var(--color-accent) var(--fill), var(--color-track) var(--fill)); }
input[type='range']::-webkit-slider-thumb { -webkit-appearance: none; width: 16px; height: 16px; margin-top: -6px; border-radius: 50%; background: var(--color-thumb); border: 2px solid var(--color-accent); box-shadow: var(--shadow-sm); }
input[type='range']::-moz-range-track { height: 4px; border-radius: var(--radius-full); background: var(--color-track); }
input[type='range']::-moz-range-progress { height: 4px; border-radius: var(--radius-full); background: var(--color-accent); }
input[type='range']::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--color-thumb); border: 2px solid var(--color-accent); }
@media (pointer: coarse) {
  input[type='range'] { height: 32px; }
  input[type='range']::-webkit-slider-thumb { width: 24px; height: 24px; margin-top: -10px; }
  input[type='range']::-moz-range-thumb { width: 20px; height: 20px; }
}
```

  New file `src/ui/controls.ts`:
  `export function syncRangeFill(input: HTMLInputElement): void` sets
  `--fill` to `((value - min) / (max - min)) * 100` percent.
  `export function bindRangeFills(root: ParentNode): void` runs `syncRangeFill` on every
  `input[type=range]` now and on each `input` event. Call it once in the constructor, then call
  `syncRangeFill` again for every range at the end of `syncControls()` and `restoreNavPrefs()`, which set
  `.value` programmatically.
- **Switch** (all checkboxes: `#wireframe #gs-2d #sort-radial #extended #flip-y #grid` and the new `#hud-switch`).
  The markup becomes `<label class="switch-row"><span>Wireframe</span><input id="wireframe" type="checkbox" class="switch" role="switch" /></label>`.
  `.switch-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: var(--control-h); font-size: var(--text-base); cursor: pointer; }`

```css
.switch { appearance: none; position: relative; flex: none; width: 32px; height: 18px; margin: 0; border-radius: var(--radius-full); background: var(--color-track); cursor: pointer; transition: background var(--dur-fast) var(--ease-out); }
.switch::before { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--color-thumb); box-shadow: var(--shadow-sm); transition: transform var(--dur-fast) var(--ease-out); }
.switch:checked { background: var(--color-accent); }
.switch:checked::before { transform: translateX(14px); }
@media (pointer: coarse) { .switch { width: 44px; height: 26px; } .switch::before { width: 22px; height: 22px; } .switch:checked::before { transform: translateX(18px); } }
```

- **Field layouts.** Sliders use `.field` with label text and `<output>` on one line, and the slider below.
  `.field { display: grid; gap: 6px; padding: 6px 0; font-size: var(--text-base); }`,
  `.field > span { display: flex; justify-content: space-between; }`,
  `.field output { color: var(--color-text-muted); font-variant-numeric: tabular-nums; }`.
  Selects use `.field-row`: `display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: var(--control-h); padding: 4px 0; font-size: var(--text-base);`.
  The `#up-using` output moves into the row label as muted text: "Up axis · Z-up".

### 4.7 Settings panel (drawer on desktop and tablet, sheet on phone)

```html
<aside id="panel" class="panel is-collapsed" aria-labelledby="panel-title">   <!-- keep id; starts collapsed -->
  <div class="panel-head">
    <span class="sheet-grip" aria-hidden="true"></span>
    <h2 id="panel-title" class="panel-title">Settings</h2>
    <button id="panel-close" class="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Close settings">  <!-- new -->
      <svg class="icon" aria-hidden="true"><use href="#i-x"/></svg>
    </button>
  </div>
  <div class="panel-body">
    <details id="sec-scene" class="sec" open><summary>Scene<svg class="icon icon-sm sec-chev" aria-hidden="true"><use href="#i-chevron-down"/></svg></summary>
      <dl id="scene-info" class="kv"></dl>                         <!-- keep -->
    </details>
    <details id="sec-geo" class="sec" open hidden>…batch 2…</details>
    <details id="sec-display" class="sec" open><summary>Display …</summary>
      <label class="field-row" data-applies="splats"><span>SH degree</span><span class="select"><select id="sh-degree">…</select>…</span></label>
      <label class="field" data-applies="splats"><span>Splat cutoff <output id="out-splat-scale">1.0</output></span><input id="splat-scale" …/></label>
      <label class="field" data-applies="points"><span>Point size <output id="out-point-size">1.0</output></span><input id="point-size" …/></label>
      <label class="field-row" data-applies="mesh"><span>Shading</span><span class="select"><select id="shading">…</select>…</span></label>
      <label class="switch-row" data-applies="mesh"><span>Wireframe</span><input id="wireframe" …/></label>
      <label class="switch-row"><span>Ground grid</span><input id="grid" …/></label>
    </details>
    <details id="sec-view" class="sec"><summary>View and navigation …</summary>
      <label class="field-row"><span>Up axis <output id="up-using">Auto</output></span><span class="select"><select id="up-axis">…</select>…</span></label>
      <label class="switch-row"><span>Flip Y (OpenCV / COLMAP)</span><input id="flip-y" …/></label>
      <label class="field"><span>Sensitivity <output id="out-sensitivity">1.0</output></span><input id="sensitivity" …/></label>
    </details>
    <details id="sec-perf" class="sec"><summary>Performance …</summary>
      <label class="field" data-applies="splats"><span>LOD detail <output id="out-lod">1.0</output></span><input id="lod-scale" …/></label>
      <label class="field-row"><span>Pixel ratio</span><span class="select"><select id="pixel-ratio">…</select>…</span></label>
      <label class="switch-row"><span>Show stats overlay</span><input id="hud-switch" type="checkbox" class="switch" role="switch" /></label>   <!-- new -->
      <dl id="perf-info" class="kv"></dl>                          <!-- keep -->
    </details>
    <details id="sec-advanced" class="sec"><summary>Advanced …</summary>
      <label class="switch-row" data-applies="splats"><span>2D Gaussian axes</span><input id="gs-2d" …/></label>
      <label class="switch-row" data-applies="splats"><span>Radial depth sort</span><input id="sort-radial" …/></label>
      <label class="switch-row" data-applies="splats"><span>Extended precision on next load</span><input id="extended" …/></label>
      <p class="hint">…existing paragraph, unchanged wording…</p>
    </details>
    <details id="sec-about" class="sec"><summary>About …</summary>
      <dl class="kv"><dt>Build</dt><dd id="build-id">dev</dd></dl>  <!-- keep #build-id -->
      <p class="hint"><a href="https://github.com/ZhangAoCanada/3Dviewer" target="_blank" rel="noopener">Source on GitHub</a> · Icons by Lucide (ISC)</p>
    </details>
  </div>
</aside>
```

- Desktop and tablet (≥641 px): `position: absolute; z-index: var(--z-panel); top: calc(var(--safe-top) + var(--inset) + var(--island-h) + var(--gap)); right: calc(var(--safe-right) + var(--inset)); bottom: calc(var(--safe-bottom) + var(--inset)); width: var(--panel-w); display: flex; flex-direction: column; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); backdrop-filter: var(--blur); box-shadow: var(--shadow-lg); animation: panel-in var(--dur-base) var(--ease-out);`
  Use `@keyframes panel-in { from { opacity: 0; transform: translateX(8px); } }`.
  Keep `.panel.is-collapsed { display: none; }` as the open/close mechanism.
- `.panel-head`: `display: flex; align-items: center; gap: var(--space-2); height: 48px; padding: 0 var(--space-2) 0 var(--space-4); border-bottom: 1px solid var(--color-border); flex: none;`
  `.panel-title`: `flex: 1; margin: 0; font-size: var(--text-md); font-weight: 600;`. `.sheet-grip` is hidden on ≥641 px.
- `.panel-body`: `flex: 1; overflow: auto; overscroll-behavior: contain; padding: 0 var(--space-4) var(--space-4);`
- `.sec + .sec { border-top: 1px solid var(--color-border); }`
  `.sec > summary { display: flex; align-items: center; justify-content: space-between; height: 40px; list-style: none; cursor: pointer; font-size: var(--text-base); font-weight: 600; }`
  `.sec > summary::-webkit-details-marker { display: none; }`
  `.sec-chev { color: var(--color-text-muted); transition: transform var(--dur-fast) var(--ease-out); }`
  `.sec:not([open]) .sec-chev { transform: rotate(-90deg); }`
  `.sec[open] { padding-bottom: var(--space-3); }`
- `.kv`: `display: grid; grid-template-columns: 104px 1fr; gap: 6px var(--space-2); margin: 0; font-size: var(--text-base);`
  `dt { color: var(--color-text-muted); }`, `dd { margin: 0; overflow-wrap: anywhere; }`.
- `.hint`: `color: var(--color-text-muted); font-size: var(--text-sm); line-height: var(--leading-sm);`.
  Links in panels use `color: var(--color-accent-text)`.
- **Contextual controls.** New `private syncApplicable()`, called at the end of `renderSceneInfo()`. Build
  `kinds = new Set(this.host.items.map(i => i.kind))`, then for each `#panel [data-applies]` set
  `el.hidden = kinds.size > 0 && !el.dataset.applies!.split(' ').some(k => kinds.has(k))`. Then hide
  any `details.sec` whose controls are all hidden. With nothing loaded, everything shows. The kind
  strings are exactly `splats`, `mesh`, `points`.
- **Open state.**
  - `togglePanel()` also toggles `body.panel-open` and writes `3dviewer-panel` (`'open'` | `'closed'`)
    via `writeStorage`.
  - In `bind()`, replace the `matchMedia('(max-width: 860px)')` block with a restore step: open only when
    the stored value is `'open'`. The default is closed at every size. Set `aria-expanded` to match.
  - `#panel-close` calls `togglePanel()` and then focuses `#panel-btn`.

### 4.8 Empty state and drop zone (Batch 2)

```html
<section id="empty" class="empty" hidden aria-labelledby="empty-title">       <!-- keep id; now starts hidden -->
  <div class="empty-card">
    <div class="empty-icon" aria-hidden="true"><svg class="icon icon-xl"><use href="#i-upload"/></svg></div>
    <h1 id="empty-title">Open a 3D scan</h1>
    <p id="empty-desc">Drop a file anywhere, or choose one from this device. Files are read locally and never uploaded.</p>  <!-- new id -->
    <div class="empty-actions">
      <button id="empty-open" class="btn btn-primary btn-lg" type="button"><svg class="icon" aria-hidden="true"><use href="#i-folder-open"/></svg>Choose file</button>  <!-- keep -->
      <button id="empty-url" class="btn btn-secondary btn-lg" type="button"><svg class="icon" aria-hidden="true"><use href="#i-link"/></svg>Open URL</button>          <!-- new -->
    </div>
    <p class="empty-formats">Splats: .ply .splat .spz .ksplat .sog .rad · Meshes: .glb .gltf .obj · Points: .ply</p>
    <div class="empty-samples" id="empty-samples">                               <!-- new -->
      <span>Try a sample</span>
      <button id="empty-sample" class="chip" type="button">3DGS torus</button>  <!-- keep -->
      <!-- buildSamples() appends one .chip per remaining SAMPLES entry (skip SAMPLES[0]) -->
    </div>
  </div>
</section>
<div id="drop-overlay" class="drop-overlay" aria-hidden="true">                <!-- new -->
  <div class="drop-inner"><svg class="icon icon-xl"><use href="#i-upload"/></svg><p>Drop to open</p><span>Splats, meshes, or point clouds</span></div>
</div>
```

- `.empty-card`: `width: min(480px, calc(100% - 2 * var(--inset))); padding: var(--space-8); border-radius: var(--radius-xl); text-align: center; background: var(--color-surface); backdrop-filter: var(--blur); border: 1px solid var(--color-border); box-shadow: var(--shadow-lg);`
  `.empty-icon`: `width: 56px; height: 56px; margin: 0 auto var(--space-4); display: grid; place-items: center; border-radius: 50%; background: var(--color-accent-soft); color: var(--color-accent-text);`
  `h1`: `margin: 0 0 var(--space-2); font-size: var(--text-xl); line-height: var(--leading-xl); letter-spacing: var(--tracking-tight);`
  `#empty-desc`: `color: var(--color-text-muted); margin: 0 auto; max-width: 36ch;`
  `.empty-actions`: `display: flex; flex-wrap: wrap; justify-content: center; gap: var(--space-2); margin-top: var(--space-6);`. At ≤640 px, make the buttons `flex: 1 1 100%`.
  `.empty-formats`: `margin: var(--space-5) 0 0; font-size: var(--text-sm); color: var(--color-text-subtle);`
  `.empty-samples`: `display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 6px; margin-top: var(--space-4); padding-top: var(--space-4); border-top: 1px solid var(--color-border); font-size: var(--text-sm); color: var(--color-text-muted);`
  `.chip`: `height: var(--control-h-sm); padding: 0 10px; border-radius: var(--radius-full); border: 1px solid var(--color-border); background: transparent; color: var(--color-text); font-size: var(--text-sm);`. On hover, use `--color-hover`.
- `main.ts`: change the selector `.empty-card p` to `#empty-desc`, and change the fallback title text to
  "The viewer could not start" by writing it to `#empty-title`.
- `#loading` now starts **visible** in HTML (no `hidden`) with `#loading-text` = "Starting viewer…", so
  the dead empty state never shows while the 1 MB bundle downloads. Every `boot()` path that loads calls
  `load*`, which ends in `setLoading(false)`. A bare URL (owner decision, Appendix B) calls
  `setLoading(false)` and shows `#empty` instead. The `main.ts` error path already hides `#loading`.
- `.drop-overlay`: `position: fixed; inset: 0; z-index: var(--z-drop); display: grid; place-items: center; padding: calc(var(--inset) + var(--safe-top)) var(--inset) var(--inset); pointer-events: none; opacity: 0; transition: opacity var(--dur-fast) var(--ease-out); background: color-mix(in srgb, var(--color-accent) 8%, transparent);`
  `.drop-inner`: `width: 100%; height: 100%; display: grid; place-content: center; justify-items: center; gap: var(--space-2); border: 2px dashed var(--color-accent); border-radius: var(--radius-xl); color: var(--color-text);`. `p` uses `--text-lg` at 600, and `span` is muted.
  `body.is-dragging .drop-overlay { opacity: 1; }`. Delete the old `body.is-dragging #viewport` outline rule.
  The drag listeners in `bind()` stay as they are.

### 4.9 Open from URL dialog (Batch 2)

```html
<dialog id="url-dialog" class="dialog" aria-labelledby="url-title">           <!-- new -->
  <form id="url-form" method="dialog">
    <div class="dialog-head">
      <h2 id="url-title">Open from URL</h2>
      <button class="btn btn-ghost btn-icon btn-sm" value="cancel" formnovalidate aria-label="Close"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button>
    </div>
    <label class="field"><span>File URL</span>
      <input id="url-input" class="input" type="url" required inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://example.com/scan.ply" />
    </label>
    <p id="url-error" class="field-error" role="alert" hidden></p>
    <p class="hint">The server must allow cross-origin requests (CORS). The link is added to the address bar so you can share this view.</p>
    <div class="dialog-actions">
      <button class="btn btn-secondary" value="cancel" formnovalidate>Cancel</button>
      <button class="btn btn-primary" value="open">Open</button>
    </div>
  </form>
</dialog>
```

- `.dialog`: `width: min(440px, calc(100vw - 2 * var(--inset))); padding: var(--space-5); border: 1px solid var(--color-border); border-radius: var(--radius-xl); background: var(--color-surface-solid); color: var(--color-text); box-shadow: var(--shadow-lg);`
  `.dialog::backdrop { background: var(--color-scrim); backdrop-filter: blur(2px); }`
  `.dialog-head`: flex with space-between; `h2` uses `--text-lg` at 600 with margin 0. `margin-bottom: var(--space-4)`.
  `.dialog-actions`: `display: flex; justify-content: flex-end; gap: var(--space-2); margin-top: var(--space-5);`
  `.input`: same box as `.select select` but `width: 100%; padding: 0 10px;`. At `(pointer: coarse)`, `font-size: 16px`.
  `.field-error`: `color: var(--color-danger); font-size: var(--text-sm); margin: 6px 0 0;`
  At ≤640 px, the dialog sticks to the bottom: `margin: auto 0 0; width: 100%; max-width: none; border-radius: var(--radius-xl) var(--radius-xl) 0 0; padding-bottom: calc(var(--space-5) + var(--safe-bottom));`.
- Open from `#url-btn`, `#empty-url`, the More menu, and the `U` key. Call `input.value = ''`,
  `urlError.hidden = true`, `dialog.showModal()`, then `input.focus()`.
- On `form` `submit`: if `(event as SubmitEvent).submitter?.value !== 'open'`, return. Parse with `new URL(value)`.
  If parsing throws, or the protocol is not `http:` or `https:`, call `preventDefault()` and show
  "Enter an http or https link." in `#url-error`.
  Otherwise let the dialog close, then call `setQuery({ url: value })` and `void this.load(sourceFromUrl(value))`.
- New helper `setQuery(params: Record<string, string> | null)` in `ViewerApp`. It writes
  `history.replaceState(null, '', location.pathname + (params ? '?' + new URLSearchParams(params) : '') + location.hash)`.
  Call it with `{ url }` from the dialog, `{ sample: sample.id }` from the samples menu and chips, and
  `null` from local file open and drop. `boot()` keeps its param order. The torus autoload is removed:
  a bare URL shows the empty state (Appendix B).

### 4.10 Samples menu and the shared menu helper (Batch 2)

- New `src/ui/menu.ts`, about 60 lines:
  `export function bindMenu(button: HTMLButtonElement, menu: HTMLElement): { close(): void }`.
  - Click toggles. On open, focus the first `[role=menuitem]`.
  - `ArrowDown`/`ArrowUp` cycle focus, `Home`/`End` jump, `Escape` closes and refocuses the button,
    `Tab` closes, and selecting an item closes.
  - A `pointerdown` outside the button and menu closes it.
  - It keeps `aria-expanded` in sync.
- `buildSamples()` builds items as `<button type="button" role="menuitem" class="menu-item"><span>${label}</span><small>${note}</small></button>`
  with **textContent, not innerHTML**. It delegates open/close to `bindMenu`, and removes its own
  `pointerdown` listener and toggle code. Clicking an item calls `setQuery({ sample: id })` and then
  `loadSample(sample)`.
- `.menu-pop`: `position: absolute; top: calc(100% + var(--gap)); right: 0; z-index: var(--z-topbar); width: 264px; padding: var(--space-1); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface-solid); box-shadow: var(--shadow-lg); animation: pop-in var(--dur-fast) var(--ease-out);`
  Use `@keyframes pop-in { from { opacity: 0; transform: translateY(-4px); } }`.
  `.menu-item`: `display: flex; flex-direction: column; align-items: flex-start; width: 100%; padding: 8px 10px; border: 0; border-radius: var(--radius-md); background: transparent; text-align: left; font-size: var(--text-base);`
  `.menu-item:hover, .menu-item:focus-visible { background: var(--color-hover); outline-offset: -2px; }`
  `.menu-item small { color: var(--color-text-muted); font-size: var(--text-sm); }`
  `.menu-heading`: `padding: 8px 10px 4px; font-size: var(--text-xs); font-weight: 600; color: var(--color-text-muted);`. This is used in the More menu.

### 4.11 Loading card with stages (Batch 2)

```html
<div id="loading" class="loading">                                              <!-- keep id -->
  <div class="loading-card">
    <div class="loading-head">
      <div class="spinner" aria-hidden="true"></div>
      <div class="loading-titles">
        <p id="loading-file" class="loading-file"></p>                            <!-- new -->
        <p id="loading-text" class="loading-text">Starting viewer…</p>            <!-- keep -->
      </div>
      <span id="loading-elapsed" class="loading-elapsed" aria-hidden="true"></span>  <!-- new -->
      <button id="loading-cancel" class="btn btn-ghost btn-sm" type="button" hidden>Cancel</button>  <!-- new -->
    </div>
    <ol id="loading-steps" class="steps" aria-hidden="true">                      <!-- new -->
      <li data-step="download"><span class="step-dot"><svg class="icon"><use href="#i-check"/></svg></span><span id="step-download-label">Read</span></li>
      <li data-step="parse"><span class="step-dot"><svg class="icon"><use href="#i-check"/></svg></span>Decode</li>
      <li data-step="gpu"><span class="step-dot"><svg class="icon"><use href="#i-check"/></svg></span>GPU upload</li>
    </ol>
    <div id="loading-track" class="load-track" role="progressbar" aria-labelledby="loading-text" aria-valuemin="0" aria-valuemax="100" hidden>  <!-- keep -->
      <div id="loading-bar" class="load-bar"></div>                              <!-- keep -->
    </div>
    <p id="loading-detail" class="loading-detail"></p>                           <!-- keep -->
    <p id="loading-sr" class="sr-only" aria-live="polite"></p>                   <!-- new -->
  </div>
</div>
```

- `.loading`: `position: absolute; inset: 0; z-index: var(--z-loading); display: grid; place-items: center; pointer-events: none;`. There is no full-screen dim anymore.
  `.loading-card`: `pointer-events: auto; width: min(440px, calc(100% - 2 * var(--inset))); display: grid; gap: var(--space-3); padding: var(--space-4); border-radius: var(--radius-lg); border: 1px solid var(--color-border); background: var(--color-surface-solid); box-shadow: var(--shadow-lg);`
  At ≤640 px: `.loading { place-items: end center; padding-bottom: calc(var(--safe-bottom) + var(--inset) + var(--island-h) + var(--gap)); }`
- `.loading-head`: `display: flex; align-items: center; gap: var(--space-3);`. `.loading-titles { flex: 1; min-width: 0; }`.
  `.loading-file`: `margin: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`
  `.loading-text`: `margin: 0; color: var(--color-text-muted); font-size: var(--text-base);`
  `.loading-elapsed`: `color: var(--color-text-muted); font-size: var(--text-sm); font-variant-numeric: tabular-nums;`
- `.steps`: `display: flex; gap: var(--space-4); margin: 0; padding: 0; list-style: none; font-size: var(--text-sm); color: var(--color-text-subtle);`
  `.steps li { display: flex; align-items: center; gap: 6px; }`
  `.step-dot`: `width: 16px; height: 16px; display: grid; place-items: center; border-radius: 50%; border: 1.5px solid currentColor;` and `.step-dot .icon { width: 10px; height: 10px; stroke-width: 3; opacity: 0; }`.
  `li.is-active { color: var(--color-text); }`, and `li.is-active .step-dot { border-color: var(--color-accent); box-shadow: inset 0 0 0 3px var(--color-accent-soft); }`.
  `li.is-done { color: var(--color-text-muted); }`, and `li.is-done .step-dot { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-on-accent); }`, with `li.is-done .icon { opacity: 1; }`.
- `.load-track`: `height: 4px; border-radius: var(--radius-full); background: var(--color-hover); overflow: hidden;`. `.load-bar` uses `background: var(--color-accent)`. Keep the indeterminate animation and its reduced-motion rule.
- `.loading-detail`: `display: flex; justify-content: space-between; margin: 0; font-size: var(--text-sm); color: var(--color-text-muted); font-variant-numeric: tabular-nums;`. Keep `:empty { display: none }`.
- **Logic** (ViewerApp; this is UI only, so the load pipeline itself does not change):
  - New fields: `loadingSource: AssetSource | null`, `loadingStage: LoadProgress['stage'] | null`,
    `loadingStarted = 0`, `elapsedTimer = 0`, `stageStarted = 0`.
  - `load()` sets `this.loadingSource = source` before the first `setLoading`. `loadDemoSlab` sets it to `null`
    and sets `#loading-file` to "Synthetic drone slab".
  - Change the signature to `setLoading(active, message = '', loaded?, total?, stage?: LoadProgress['stage'])`. The
    `onProgress` callback passes `progress.stage`. The initial `Opening …` call passes `'detect'`.
  - `#loading-file` = `${source.name}` plus `· ${formatBytes(source.sizeBytes)}` when the size is known.
  - `#step-download-label` = `source.origin === 'file' ? 'Read' : 'Download'`.
  - Steps use the order `['download', 'parse', 'gpu']`. The active index is the stage's index (`detect` = -1,
    `ready` = 3). Earlier steps get `is-done`, the current step gets `is-active`, and later steps get neither.
    When the stage changes, write `#loading-sr` = `${label of step}, step ${i+1} of 3` and set `stageStarted = now`.
  - **Bar:** determinate only when `known && stage !== 'gpu'`. In `gpu`, it is always indeterminate. Set
    `aria-valuenow` to the rounded percent, or remove the attribute when indeterminate.
  - **Detail line:** for a determinate bar, show the left text and `${pct}%` on the right. The left text is
    `${formatBytes(loaded)} of ${formatBytes(total)}` when `stage === 'download'` or
    `total === this.loadingSource?.sizeBytes`, and otherwise empty. The loader `message` already carries
    splat counts. In `gpu`, once `now - stageStarted > 20000`, show
    "Large scenes can take a few minutes on the GPU."; otherwise the detail line is empty.
  - **Elapsed:** when `active` becomes true, start a 1 s `setInterval` that writes `m:ss` since `loadingStarted`
    to `#loading-elapsed`. Clear it when `active` becomes false. Only show the timer after 3 s
    (`textContent = ''` before that).
  - **Cancel:** `#loading-cancel.hidden = this.loadAbort === null`. In `load()`'s `finally`, add
    `if (this.loadAbort === abort) this.loadAbort = null;`. The click handler is:

```ts
private cancelLoad(): void {
  const abort = this.loadAbort;
  if (!abort) return;
  this.loadAbort = null;
  this.generation += 1;            // the in-flight load() now ignores its result and its error
  abort.abort(new DOMException('Loading cancelled', 'AbortError'));
  this.setLoading(false);
  this.setEmpty(this.host.items.length === 0);
  this.toast('Loading cancelled.', 'info');
}
```

  `Escape` while loading (and no dialog open) also calls `cancelLoad()`.

### 4.12 Toasts and update prompt (Batch 2)

```html
<div class="toast-stack">                                                        <!-- new wrapper -->
  <div id="toast" class="toast" role="status" data-kind="error" hidden>          <!-- keep id -->
    <svg class="icon toast-icon" aria-hidden="true"><use id="toast-icon" href="#i-circle-alert"/></svg>  <!-- new -->
    <p id="toast-msg" class="toast-msg"></p>                                       <!-- new -->
    <button id="toast-close" class="btn btn-ghost btn-icon btn-sm" type="button" aria-label="Dismiss"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button>  <!-- new -->
  </div>
  <div id="update-toast" class="toast toast-update" role="status" hidden>       <!-- keep id -->
    <svg class="icon toast-icon" aria-hidden="true"><use href="#i-refresh-cw"/></svg>
    <p class="toast-msg"><strong>Update available</strong><span>Reload to use the latest version.</span></p>
    <button id="update-later" class="btn btn-ghost btn-sm" type="button">Later</button>       <!-- new -->
    <button id="update-reload" class="btn btn-primary btn-sm" type="button">Reload</button>   <!-- keep -->
  </div>
</div>
```

- `.toast-stack`: `position: absolute; z-index: var(--z-toast); left: 50%; transform: translateX(-50%); bottom: calc(var(--safe-bottom) + var(--inset) + var(--island-h) + var(--space-3)); width: min(520px, calc(100% - 2 * var(--inset))); display: flex; flex-direction: column-reverse; gap: var(--gap); pointer-events: none;`
  Apply the same `body.panel-open` left offset as the toolbar at ≥641 px.
- `.toast`: `pointer-events: auto; display: flex; align-items: flex-start; gap: var(--space-3); padding: 10px 6px 10px var(--space-3); border: 1px solid var(--color-border); border-left: 3px solid var(--toast-c, var(--color-accent)); border-radius: var(--radius-md); background: var(--color-surface-solid); color: var(--color-text); box-shadow: var(--shadow-lg); font-size: var(--text-base); animation: toast-in var(--dur-base) var(--ease-out);`
  Use `@keyframes toast-in { from { opacity: 0; transform: translateY(6px); } }`.
  `.toast-icon { color: var(--toast-c); margin-top: 1px; }`, `.toast-msg { flex: 1; margin: 2px 0 0; white-space: pre-wrap; }`.
  `[data-kind='error'] { --toast-c: var(--color-danger); }`, `[data-kind='warn'] { --toast-c: var(--color-warning); }`, `[data-kind='info'] { --toast-c: var(--color-accent); }`.
  `.toast-update`: `align-items: center; --toast-c: var(--color-accent);`, `.toast-update .toast-msg span { display: block; color: var(--color-text-muted); font-size: var(--text-sm); }`.
- `toast(message, kind: 'error' | 'warn' | 'info' = 'error')`:
  - Set `#toast.dataset.kind`, set `role` to `'alert'` for errors and `'status'` otherwise, and set `#toast-icon`'s
    `href` to `#i-circle-alert`, `#i-triangle-alert` or `#i-info`.
  - Write the text to `#toast-msg` (not to `#toast` itself). Keep the existing hold formula.
  - `pointerenter` and `focusin` on `#toast` clear the timer. `pointerleave` and `focusout` restart it at 4000 ms.
    `#toast-close` hides it.
  - Uses that become `'info'`: "Nothing under the center…", "Loading cancelled.", "Copied georeference."
    All other call sites keep their kind.
- `registerUpdate.ts`: add `#update-later` click → `toast.hidden = true` (no `postMessage`). On Reload click, also
  set `button.textContent = 'Reloading…'`. Do not touch the service-worker logic, the `controllerchange` →
  `if (!toast.hidden) reload()` check, or `HAS_TOAST`.
- The toast and the nav hint share the spot above the toolbar, so `toast()` also sets `#nav-hint.hidden = true`.

### 4.13 Phone layout and bottom sheet (Batch 3)

- **More menu** (phone only). Add this at the end of `.top-actions`:

```html
<div class="menu show-phone">
  <button id="more-btn" class="btn btn-ghost btn-icon" type="button" aria-label="More" aria-haspopup="menu" aria-expanded="false" aria-controls="more-menu"><svg class="icon" aria-hidden="true"><use href="#i-ellipsis"/></svg></button>
  <div id="more-menu" class="menu-pop" role="menu" aria-label="More" hidden>
    <button type="button" role="menuitem" class="menu-item menu-item-row" data-action="url"><svg class="icon" aria-hidden="true"><use href="#i-link"/></svg>Open from URL</button>
    <button type="button" role="menuitem" class="menu-item menu-item-row" data-action="theme"><svg class="icon only-dark" aria-hidden="true"><use href="#i-sun"/></svg><svg class="icon only-light" aria-hidden="true"><use href="#i-moon"/></svg><span class="theme-label">Light theme</span></button>
    <button type="button" role="menuitem" class="menu-item menu-item-row" data-action="help"><svg class="icon" aria-hidden="true"><use href="#i-circle-help"/></svg>Controls</button>
    <div class="menu-heading" role="presentation">Samples</div>
    <div id="more-samples" role="none"></div>   <!-- buildSamples() appends the same items here -->
  </div>
</div>
```

  `.menu-item-row { flex-direction: row; align-items: center; gap: 10px; min-height: var(--control-h); }`. Wire it with `bindMenu`.
  The `data-action` values call `openUrlDialog()`, `toggleTheme()` and `openHelp()`. `toggleTheme()` updates
  `.theme-label` to "Light theme" or "Dark theme".
  On the phone, the visible top-right buttons are `#open-btn` (icon only), `#panel-btn` and `#more-btn`, three
  controls at 44 px.
- **Bottom sheet** `@media (max-width: 640px)` for `#panel`:
  `top: auto; left: 0; right: 0; bottom: 0; width: auto; max-height: min(70dvh, 640px); border-radius: var(--radius-xl) var(--radius-xl) 0 0; border-bottom: 0; padding-bottom: var(--safe-bottom); animation-name: sheet-in;`
  Use `@keyframes sheet-in { from { transform: translateY(24px); opacity: 0; } }`.
  `.sheet-grip`: `display: block; position: absolute; top: 6px; left: 50%; width: 36px; height: 4px; margin-left: -18px; border-radius: var(--radius-full); background: var(--color-border-strong);`.
  `.panel-head` gets `position: relative; height: 52px; padding-top: 8px;`.
  The sheet covers the toolbar (`--z-panel` > `--z-toolbar`). That is intended.
- **Swipe to close:** in `ViewerApp`, track `pointerdown`/`pointerup` on `.panel-head`. If the pointer moved
  down more than 64 px, call `togglePanel()`. Twenty lines at most; no inertia.
- **Phone landscape** `@media (max-width: 960px) and (max-height: 520px) and (pointer: coarse)`: the panel goes
  back to the right drawer with `width: min(var(--panel-w), 46vw); top: calc(var(--safe-top) + var(--inset)); border-radius: var(--radius-lg);`.
  `.sheet-grip` is hidden, and the toolbar uses the `body.panel-open` offset.
- **Safe areas:** every inset-positioned island already includes `--safe-*` (sections 4.3, 4.4, 4.5, 4.11 and
  4.12). Add `<meta name="apple-mobile-web-app-capable" content="yes">` and
  `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">` to `<head>`.
- **Escape:** if a menu is open, close it. Otherwise, if `#panel` is open and focus is inside it, close it
  and focus `#panel-btn`. Native `<dialog>` handles its own Escape.

### 4.14 Controls and shortcuts dialog (Batch 2)

`<dialog id="help-dialog" class="dialog dialog-wide" aria-labelledby="help-title">` uses
`width: min(640px, calc(100vw - 2 * var(--inset)))`. The head is "Controls and shortcuts" plus a close
button (`form method="dialog"`). The body is three groups in a 3-column grid at ≥641 px and stacked
below that. Each group has a heading with an icon (`mouse`, `hand`, `keyboard`) and a `<dl class="keys">`.
Use this exact copy, which matches the current `Navigation.ts`:

- **Mouse:** Orbit = Drag (around the point under the cursor). Pan = Right-drag, middle-drag, or
  Shift/Ctrl + drag. Zoom = Scroll (toward the cursor). Fly to a point = Double-click.
- **Touch:** Orbit = One-finger drag. Pan and zoom = Two fingers (drag and pinch). Fly to a point = Double-tap.
  Fly mode: look = one-finger drag; move forward or back = two-finger drag up or down.
- **Keyboard:** `1` Orbit mode · `2` Fly mode · `F` Focus the center · `R` Reset view · `O` Open file ·
  `U` Open URL · `H` Settings · `I` Stats · `G` Ground grid · `T` Theme · `?` This help · `Esc` Close or cancel.
  Fly mode: `W A S D` or arrows move · `Q` / `E` down / up (`Space` also up) · `Shift` sprint.

`kbd`: `display: inline-grid; place-items: center; min-width: 22px; height: 22px; padding: 0 6px; border: 1px solid var(--color-border-strong); border-bottom-width: 2px; border-radius: var(--radius-sm); font: 600 var(--text-xs)/1 var(--font-sans); color: var(--color-text);`.
`.keys { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; font-size: var(--text-base); }`, and `dt` is muted.
Delete the old Controls section and `.help` CSS from the panel.

### 4.15 Nav hint (Batch 3)

```html
<p id="nav-hint" class="nav-hint" hidden>                    <!-- keep id -->
  <span class="hint-mouse">Drag to orbit · Right-drag to pan · Scroll to zoom · Double-click to fly in · <kbd>?</kbd> for help</span>
  <span class="hint-touch">Drag to orbit · Two fingers to pan and zoom · Double-tap to fly in</span>
</p>
```

- Position it like the toast stack (above the toolbar). Use `pointer-events: none`, `--text-sm` muted on
  `--color-surface`, `--radius-full`, and padding `6px 12px`.
- `@media (pointer: coarse) { .hint-mouse { display: none } }` and `@media (pointer: fine) { .hint-touch { display: none } }`.
- Behavior: after the first successful `load()` or `loadDemoSlab()`, show it if `localStorage['3dviewer-hint'] !== 'seen'`.
  Hide it on the first `pointerdown` or `wheel` on `#view`, or after 8000 ms, whichever comes first. Then
  write `3dviewer-hint = 'seen'`. Fade it out with an opacity transition (`--dur-slow`).

---

## 5. Keyboard shortcuts

These are in addition to the existing handler in `ViewerApp.bind()`. Keep its guard
(`isTypingTarget || meta || ctrl || alt`), and also return early when `document.querySelector('dialog[open]')`
is set. Use `event.code` for letters and digits (as today), and `event.key === '?'` for help.

| Key | Action | Status |
| --- | --- | --- |
| `1` / `2` | Orbit / Fly | existing |
| `F` | Focus the center (`focusCenter()`) | existing |
| `R` | Reset view | existing |
| `H` | Toggle settings | existing |
| `O` | Open file picker (`#file-input.click()`) | new (B3) |
| `U` | Open URL dialog | new (B3) |
| `I` | Toggle stats HUD (and `#hud-switch`, storage) | new (B3) |
| `G` | Toggle ground grid: flip `settings.showGrid`, sync `#grid.checked`, `applySettings` | new (B3) |
| `T` | Toggle theme | new (B3) |
| `?` | Open the help dialog | new (B2) |
| `Esc` | Close a menu, then cancel loading, then close the phone sheet (dialogs close natively) | new (B3) |

None of these collide with the fly keys (`WASD`, arrows, `Q`, `E`, `Space`, `Shift`). `Navigation.ts`
already ignores the meta and ctrl modifiers.

## 6. Accessibility checklist

- Every icon-only button has an `aria-label` and a `title`. Toggle buttons expose state with `aria-pressed`
  (`.seg`) or `aria-expanded` (`#panel-btn`, `#samples-btn`, `#more-btn`, `#hud-toggle`).
- `:focus-visible` rings everywhere (section 4.2). Tab order: top-left island, top-right island, HUD,
  canvas, toolbar, panel, toasts. Do not set any positive `tabindex`.
- Live regions: `#toast` (status, or alert for errors), `#update-toast` (status), `#loading-sr`
  (polite, stage changes only). Remove `aria-live` from `#hud`.
- Menus use `role="menu"` and `menuitem` with arrow-key support (section 4.10). Dialogs are native
  `<dialog>` with `showModal()`, which gives focus trap, Escape and inert background.
- `#panel` is a labelled `<aside>`. `<details>`/`<summary>` give native expand semantics.
- Contrast is listed in section 2. Do not put text in `--color-text-subtle` below 12 px.
- Touch targets are ≥44 px under `(pointer: coarse)` through the tokens. Inputs use 16 px under coarse
  pointers (no iOS zoom).
- Reduced motion: tokens zero all durations, and the existing spinner and indeterminate-bar fallbacks stay.
  Camera flights live in `src/render` and are out of scope; note this as a follow-up and do not change
  them here.
- `html[lang="en"]` is already set. The canvas `aria-label` becomes "3D viewport. Press question mark for
  controls."

## 7. Bundle budget

- No new runtime dependencies. Icons are an inline sprite in `index.html` (about 6 KB raw, about 2 KB gzip).
- Remove the `@fontsource/ibm-plex-mono` import from `src/main.ts` and the dependency from `package.json`
  (run `npm uninstall @fontsource/ibm-plex-mono`). `--font-mono` is a system stack. This saves one woff2 in
  the precache.
- Baseline on `main`: `index-*.css` 3.0 KB gzip; `index-*.js` 1,064 KB gzip.
  Limits after Batch 3: CSS ≤ 7.5 KB gzip; JS ≤ +6 KB gzip over baseline; `dist/index.html` ≤ 32 KB raw.
  Measure with `gzip -c dist/assets/index-*.css | wc -c`, the same for the main `index-*.js`, and
  `wc -c dist/index.html`. Put the numbers in each PR description.

## 8. Do not change

1. **Everything under** `src/render/`, `src/loaders/`, `src/core/`, `src/workers/`, `src/streaming/`,
   `src/renderables/`, plus `public/sw-update.js`, `vite.config.ts`, `playwright.config.ts`, and
   `tests-e2e/smoke.spec.ts`.
2. **Settings model:** `RenderSettings` fields and `DEFAULT_SETTINGS`. Every `bindSettings()` handler body,
   which only gains the range-fill sync. All slider `min`, `max`, `step` and `value` attributes: splat cutoff
   0.75 to 1.15 step 0.05 value 1; point size 0.25 to 4 step 0.05 value 1; LOD 0.35 to 2 step 0.05 value 1;
   sensitivity 0.4 to 2 step 0.05 value 1. All `<option value>`s.
3. **Storage keys and values:** `3dviewer-theme` (`light` | `dark`; also read by the inline script in
   `index.html`, which must stay first in `<head>`), `3dviewer-up` (`auto` | `y` | `z`), `3dviewer-sensitivity`.
   New keys (`3dviewer-panel`, `3dviewer-hud`, `3dviewer-hint`) go through `writeStorage()`, and reads are
   wrapped in try/catch.
4. **URL params:** `url`, `sample` (id or href suffix), `demo=slab`, `n`. Keep the `boot()` order.
   `setQuery()` only writes these same params. Owner decision, done in Batch 2: a bare URL with no
   `?url=` shows the empty state with sample buttons and does not auto-load the torus.
5. **Load pipeline:** the generation counter, `loadAbort`, watchdog and `stallFor` timings, the `large`
   pre-clear, `explainLoadError`, and `stallMessage`. The only additions are the `loadAbort = null` line in
   `finally` and `cancelLoad()`.
6. **Bound element IDs** (must exist, same element type): `#view #file-input #open-btn #empty-open
   #empty-sample #samples-btn #samples-menu #mode-orbit #mode-fly #reset-btn #theme-btn #panel-btn #panel
   #empty #loading #loading-text #loading-track #loading-bar #loading-detail #toast #hud-fps #hud-ms
   #hud-splats #hud-points #hud-tris #hud-gpu #scene-info #perf-info #splat-scale #point-size #lod-scale
   #sh-degree #shading #pixel-ratio #wireframe #gs-2d #sort-radial #extended #flip-y #grid #up-axis #up-using
   #sensitivity #out-splat-scale #out-point-size #out-lod #out-sensitivity #build-id #update-toast
   #update-reload #nav-hint`.
7. **E2E contract:** `#loading` gains `hidden` when a load finishes, and `#hud-splats`, `#hud-points` and
   `#hud-tris` hold `formatCount` text.
8. **Canvas:** `#view` keeps `tabindex="0"` and `touch-action: none`, and stays full-viewport under every
   overlay. Overlay containers (`.topbar`, `.loading`, `.toast-stack`, `.drop-overlay`, `.nav-hint`) use
   `pointer-events: none`, and only their islands or cards accept input.
9. **Existing shortcuts and fly keys** (section 5), and the drag-and-drop listeners in `bind()`.
10. **No UI framework, no CSS framework, no icon package at runtime.**

---

## 9. Implementation batches

Each batch is one PR from a fresh branch off `main`. Before you open the PR, all of these must pass:
`npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`. Also run the
screenshot harness (Appendix A) and attach the listed screenshots to the PR description.

### Batch 1: Design system, top bar, toolbar, settings panel, HUD

| # | Task | Files and selectors | Done when |
| --- | --- | --- | --- |
| [x] 1.1 | Replace the tokens (section 2). Rewrite every rule to the new variable names. Add base `body`, `:focus-visible`, `.sr-only`, `.island` and `.divider`. | `src/styles.css` (`:root`, `:root[data-theme='light']`, all rules) | `rg -n "var\(--(bg|elev|line|muted|accent-ink|accent-2|danger|shadow|radius|font|mono|top)\)" src/styles.css` returns nothing. No hex or rgba values outside the two token blocks, except the `#fff` gradients in `.mark`. |
| [x] 1.2 | Add the icon sprite (section 4.1) and `.icon` CSS. | `index.html` (first child of `<body>`), `src/styles.css` | All 30 `<symbol id="i-…">` are present, and `rg -c "<symbol" index.html` prints 30. |
| [x] 1.3 | Buttons, segment, select, range, switch, field rows (sections 4.2 and 4.6). Add `src/ui/controls.ts` with `syncRangeFill` and `bindRangeFills`, and call them from `ViewerApp`. | `index.html` (every `.btn`, `.seg`, `select`, checkbox and range), `src/styles.css`, `src/ui/controls.ts` (new), `src/app/ViewerApp.ts` (`constructor`, `syncControls`, `restoreNavPrefs`) | Sliders show the accent fill up to the thumb after load and after restoring a stored sensitivity. All six checkboxes render as switches with `role="switch"`. |
| [x] 1.4 | Top bar: two islands with the markup from section 4.3, without `#url-btn`, `#help-btn`, `#geo-badge` (those come in Batch 2). Move `#mode-*` and `#reset-btn` out. File chip filled at the end of `renderSceneInfo()`: hidden when there are no items, otherwise `#file-kind` (`splats` → "Splats", `mesh` → "Mesh", `points` → "Points", `voxels` → "Voxels"), `#file-name` (and `title`), and `#file-size` = `formatBytes(meta.bytes)`. Theme button aria-label sync. | `index.html` (`header.topbar`), `src/styles.css` (`.topbar`, `.brand`, `.file-chip`, `.badge`, `.top-actions`, `.only-dark`, `.only-light`, `.hide-phone`, `.show-phone`), `src/app/ViewerApp.ts` (`renderSceneInfo`, `toggleTheme`, constructor) | At 1280x800 the top bar is two islands, both 40 px tall, with the scene visible between them. At 390x844 it is a single row. The theme icon shows a sun in dark and a moon in light. |
| [x] 1.5 | Bottom toolbar (section 4.4) with `focus-btn`, `fullscreen-btn` and `aria-pressed`. Factor out `focusCenter()`. | `index.html` (`nav#toolbar`), `src/styles.css` (`.toolbar`, `.segment`, `.seg`), `src/app/ViewerApp.ts` (`setMode`, the `KeyF` branch, new `focusCenter`, fullscreen wiring) | Clicking Focus with nothing at the center shows the existing message; its colour is not checked until Batch 2. Full screen toggles and its icon swaps. On iPhone emulation the button is hidden. |
| [x] 1.6 | Settings panel (section 4.7): header, close, `details` sections, re-grouped fields, `data-applies` plus `syncApplicable()`, starts closed, `3dviewer-panel` persistence, `body.panel-open`. Keep the old help list as a temporary last section, `<details id="sec-controls" class="sec">` titled "Controls". | `index.html` (`aside#panel`), `src/styles.css` (`.panel*`, `.sec*`, `.kv`, `.hint`), `src/app/ViewerApp.ts` (`bind` panel block, `togglePanel`, `renderSceneInfo`, new `syncApplicable`) | With the torus PLY loaded, Point size, Shading and Wireframe are hidden. With `?sample=crate`, the splat-only fields are hidden. A reload keeps the panel open or closed. `H` still toggles it. |
| [x] 1.7 | HUD (section 4.5): compact pill, expandable detail, no `aria-live`, zero rows hidden, `formatCompact`, `#hud-switch`, `3dviewer-hud`. | `index.html` (`#hud`), `src/styles.css` (`.hud*`), `src/ui/format.ts`, `tests/format.test.ts` (new), `src/app/ViewerApp.ts` (`renderPerf`, `bindSettings`, constructor) | `npm test` passes the new format tests. `npm run test:e2e` is green without changes. The pill reads like "60 fps · 4.8K splats · 480 KB". |
| [x] 1.8 | Drop IBM Plex Mono (section 7). | `src/main.ts`, `package.json`, `package-lock.json` | `rg -n "plex" src package.json` returns nothing. |
| [x] 1.9 | Add the screenshot harness (Appendix A) and ignore its output. | `tests-e2e/ui-shots.spec.ts` (new), `.gitignore` (add `artifacts/`) | `npm run test:e2e` reports the shot tests as skipped. `UI_SHOTS=1 npx playwright test ui-shots` writes the PNGs. |

**Batch 1 screenshots** (1280x800 and 390x844, dark and light): `loaded`, `panel`.
Check that the panel at 1280 does not cover the toolbar, that there is no wrapped top bar at 390, and that
the light theme has visible borders on islands and inputs.

### Batch 2: Open, load, and feedback flows (plus georeference and help)

| # | Task | Files and selectors | Done when |
| --- | --- | --- | --- |
| [x] 2.1 | Empty state (section 4.8), `#loading` visible at boot with "Starting viewer…", `main.ts` fallback selectors. | `index.html` (`#empty`, `#loading`), `src/styles.css` (`.empty*`, `.chip`), `src/main.ts`, `src/app/ViewerApp.ts` (`buildSamples` adds chips into `#empty-samples`) | `?url=missing.ply` shows the redesigned empty card plus an error toast. On a cold load the empty card never flashes before the torus. |
| [x] 2.2 | Drop overlay (section 4.8). | `index.html` (`#drop-overlay`), `src/styles.css` (remove the `body.is-dragging #viewport` rule) | Dragging a file over the page shows the dashed overlay. Dropping loads the file. The overlay never blocks the drop. |
| [x] 2.3 | URL dialog and `setQuery()` (section 4.9). | `index.html` (`#url-dialog`, `#url-btn`, `#empty-url`), `src/styles.css` (`.dialog*`, `.input`, `.field-error`), `src/app/ViewerApp.ts` (new `openUrlDialog`, `setQuery`; `loadSample` callers; file `change` and `drop` call `setQuery(null)`) | Entering `https://sparkjs.dev/assets/splats/butterfly.spz` loads it and the address bar shows `?url=…`. `ftp://x` shows the inline error. Esc and Cancel close without loading. |
| [x] 2.4 | `src/ui/menu.ts` and the samples menu rebuilt on it (section 4.10). | `src/ui/menu.ts` (new), `src/app/ViewerApp.ts` (`buildSamples`), `src/styles.css` (`.menu-pop`, `.menu-item`, `.menu-heading`) | Keyboard-only: Tab to Samples, Enter, ArrowDown ×2, Enter loads the third sample. Esc returns focus to the button. No `innerHTML` is left in `buildSamples`. |
| [x] 2.5 | Loading card with stages, elapsed time, cancel, and an SR live line (section 4.11). | `index.html` (`#loading`), `src/styles.css` (`.loading*`, `.steps`, `.step-dot`), `src/app/ViewerApp.ts` (`load`, `loadDemoSlab`, `setLoading`, new `cancelLoad`) | `?demo=slab&n=1500000` shows the card. Dropping a ≥200 MB PLY shows Read ✓, then Decode active with a percent, then GPU upload with an indeterminate bar. Cancel returns to the empty state with an info toast and no error toast. The e2e suite is still green. |
| [x] 2.6 | Toasts and update prompt (section 4.12). | `index.html` (`.toast-stack`, `#toast`, `#update-toast`), `src/styles.css` (`.toast*`), `src/app/ViewerApp.ts` (`toast` and its call sites), `src/app/registerUpdate.ts` (`#update-later`, the Reloading label) | The F key with nothing at the center shows a teal info toast. A missing URL shows a red error with `role="alert"`. Hovering pauses auto-dismiss. To check the update prompt, temporarily run `document.querySelector('#update-toast').hidden = false` in DevTools; it stacks above the toolbar and is not covered by the panel. |
| [x] 2.7 | Georeference section, geo badge, Copy, and the Scene rows. Scene rows, in this order: File, Type (Gaussian splats / Mesh / Point cloud / Voxels), Format (`loaderId`), Size, then a count label per kind (Splats / Points / Vertices), Source (only if it differs, value suffixed " (subsampled to fit memory)"), Triangles, Load time (`< 1000 ms` → "N ms", otherwise `(ms/1000).toFixed(1) + " s"`), then any other `extra` entries except `epsg`, `offset`, `bounds` and `note`, with labels from `{ stride: 'Sample stride', header: 'Header count', body: 'Body count' }` and the raw key otherwise. Georef rows come from `extra`: CRS (`EPSG:${code}`, where code = `epsg` with any `EPSG:` prefix removed), Offset (`offset`), Min and Max (`bounds` split on `→`, trimmed). `.kv-mono` uses `font-family: var(--font-mono); font-size: var(--text-sm)`. The Copy button writes the 4-line text below to `navigator.clipboard`, then shows an info toast "Copied georeference.". `#geo-epsg-link` points to `https://epsg.io/${code}` and is shown only when `/^\d+$/.test(code)`. `#geo-badge` is visible when an EPSG code exists; clicking it opens the panel, sets `#sec-geo.open = true`, scrolls it into view and focuses its `summary`. | `index.html` (`#sec-geo`, `#geo-info`, `#geo-copy`, `#geo-epsg-link`, `#geo-badge`), `src/styles.css` (`.kv-mono`, `.sec-actions`, `.badge-geo`), `src/app/ViewerApp.ts` (`renderSceneInfo`, new `renderGeoref`) | A PLY with `epsg`, `offset_*` and bounds comments (see `tests/gaussianPly.test.ts` for the header format) shows the badge and the section. A file without a georef has neither. Clipboard text matches the format below. |
| [x] 2.8 | Help dialog (section 4.14), `#help-btn`, the `?` key. Delete `#sec-controls` and `.help`. | `index.html` (`#help-dialog`, `#help-btn`), `src/styles.css` (`kbd`, `.keys`, `.dialog-wide`), `src/app/ViewerApp.ts` (new `openHelp`, keydown) | `?` opens it and Esc closes it. The copy matches section 4.14 word for word. |

The Copy format (2.7) is four lines; omit any line whose value is missing:

```
CRS: EPSG:32617
Offset: 500000, 4649776, 0
Bounds min: …
Bounds max: …
```

**Batch 2 screenshots** (both sizes, both themes): `loaded`, `empty-error`, `url-dialog`, `help`, `loading`.
At desktop dark only, also capture `samples-menu` (menu open).

### Batch 3: Phone and tablet layout, shortcuts, hint, accessibility polish

| # | Task | Files and selectors | Done when |
| --- | --- | --- | --- |
| [x] 3.1 | The More menu, and the phone top bar reduced to Open, Settings and More (section 4.13). `buildSamples` also fills `#more-samples`. | `index.html` (`#more-btn`, `#more-menu`), `src/app/ViewerApp.ts` (`buildSamples`, new action wiring), `src/styles.css` (`.menu-item-row`, `.show-phone`) | At 390 px the top-right island has exactly three 44 px buttons. Every action in More works. |
| [x] 3.2 | Bottom sheet, swipe to close, phone landscape drawer, iOS meta tags (section 4.13). | `src/styles.css` (`@media (max-width: 640px)` and the landscape query), `index.html` (`<head>` meta), `src/app/ViewerApp.ts` (swipe handler) | At 390x844 the sheet covers ≤70% of the height with a grip. Its last control clears the home-indicator safe area (check with Playwright `isMobile`). At 844x390 the panel is a right drawer. |
| [x] 3.3 | New shortcuts `O U I G T Esc` and the `dialog[open]` guard (section 5). | `src/app/ViewerApp.ts` (keydown handler, new `toggleHud`, `toggleGrid`) | Each key works, and none of them fire while typing in the URL input or while a dialog is open. In fly mode, `WASD`/`QE`/`Space` still move the camera. |
| [x] 3.4 | First-visit nav hint (section 4.15). | `index.html` (`#nav-hint`), `src/styles.css` (`.nav-hint`, `.hint-mouse`, `.hint-touch`), `src/app/ViewerApp.ts` | A fresh profile sees the hint after the first load. It disappears on the first canvas pointerdown and never shows again. Touch emulation shows the touch copy. |
| [x] 3.5 | Accessibility pass (section 6): aria-labels, canvas label, tab order, contrast spot-check with DevTools, reduced-motion check (`page.emulateMedia({ reducedMotion: 'reduce' })` → no panel, sheet, toast or menu animations). | All UI files | The section 6 checklist is ticked item by item in the PR description. |
| [x] 3.6 | Bundle budget check (section 7) and final full screenshot matrix. | none | The numbers are in the PR and within limits. |

**Batch 3 screenshots:** the full matrix from Appendix A, at both sizes and both themes:
`loaded`, `panel`, `empty-error`, `url-dialog`, `help`, `loading`. At phone dark only, also capture `more-menu`.
At 1024x1366 dark (iPad portrait, touch), capture `loaded` and `panel`.

---

## Appendix A: Screenshot harness (`tests-e2e/ui-shots.spec.ts`)

This file is skipped unless `UI_SHOTS=1`, so CI is unaffected. Install the browser with
`npx playwright install chromium`. If that is not possible, set `CHROME_PATH` (for example
`/usr/local/bin/google-chrome`). Run it with `npm run build && UI_SHOTS=1 npx playwright test ui-shots`.
The output goes to `artifacts/ui/` (gitignored).

```ts
import { expect, test, type Page } from '@playwright/test';

const enabled = !!process.env.UI_SHOTS;
const out = process.env.UI_SHOTS_DIR ?? 'artifacts/ui';

test.use({
  launchOptions: {
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
});

const sizes = [
  { name: 'desktop', width: 1280, height: 800, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
];

async function settle(page: Page) {
  await page.waitForFunction(() => document.querySelector('#loading')?.hasAttribute('hidden'), null, { timeout: 110_000 });
  await page.waitForTimeout(800);
}

for (const size of sizes) {
  for (const theme of ['dark', 'light'] as const) {
    test.describe(`${size.name} ${theme}`, () => {
      test.skip(!enabled, 'set UI_SHOTS=1');
      test.use({
        viewport: { width: size.width, height: size.height },
        hasTouch: size.touch,
        isMobile: size.touch,
        deviceScaleFactor: 1,
      });
      test.beforeEach(async ({ page }) => {
        test.setTimeout(120_000);
        await page.addInitScript((t) => {
          localStorage.setItem('3dviewer-theme', t);
          localStorage.setItem('3dviewer-hint', 'seen');
        }, theme);
      });
      const shot = (page: Page, state: string) =>
        page.screenshot({ path: `${out}/${size.name}-${theme}-${state}.png` });

      test('loaded', async ({ page }) => {
        await page.goto('?sample=torus-ply');
        await settle(page);
        await shot(page, 'loaded');
      });
      test('panel', async ({ page }) => {
        await page.goto('?sample=torus-ply');
        await settle(page);
        await page.click('#panel-btn');
        await shot(page, 'panel');
      });
      test('empty-error', async ({ page }) => {
        await page.goto('?url=missing.ply');
        await expect(page.locator('#toast')).toBeVisible({ timeout: 60_000 });
        await shot(page, 'empty-error');
      });
      test('loading', async ({ page }) => {
        await page.goto('?demo=slab&n=1500000');
        await expect(page.locator('#loading')).toBeVisible();
        await page.waitForTimeout(300);
        await shot(page, 'loading');
      });
      // Batch 2+: uncomment as the features land.
      // test('url-dialog', … click '#url-btn' (desktop) or '#more-btn' then '[data-action=url]' (phone) …)
      // test('help', … page.keyboard.press('Shift+Slash') (desktop) or More → Controls (phone) …)
      // test('samples-menu', … desktop dark only: click '#samples-btn' …)
      // test('more-menu', … phone dark only: click '#more-btn' …)
    });
  }
}
```

Add the iPad case in Batch 3 as a third `sizes` entry: `{ name: 'ipad', width: 1024, height: 1366, touch: true }`,
limited to `loaded` and `panel` in dark.

## Appendix B: Open questions — owner answers

1. **Bare URL.** A bare URL with no `?url=` shows the new empty state with sample buttons and no longer
   auto-loads the torus. That changes `boot()`, so it is Batch 2 work. Batch 1 still auto-loads the torus.
2. **Accent.** Keep the teal accent (`--color-accent` and the related tokens in both themes).
3. **Settings.** The settings panel starts closed on all screen sizes. Do not default `3dviewer-panel` to
   `'open'` when `matchMedia('(min-width: 1440px)')` matches.
