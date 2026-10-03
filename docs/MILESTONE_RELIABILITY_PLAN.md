# Milestone: open confidently, navigate comfortably, recover safely

## Status

Planned, nothing implemented. Base: `main` at `94799fd` (after the Omniview rebrand). Line numbers refer to that commit; if they moved, search for the quoted symbol.

Four batches. Each batch is one PR from a fresh branch off `main`. Each one merges on its own: where a later batch reuses something from an earlier one, the batch says what to do if the earlier one has not landed. The recommended order is 1 → 2 → 3 → 4.

Before each PR: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`. All unit tests are pure-logic Vitest in the `node` environment (there is no jsdom), so new logic goes into small pure modules and DOM wiring is covered by Playwright Chromium.

## Ground rules

- **Visual style**: dark graphite surfaces, teal accent, floating `.island` panels, Lucide sprite icons, DM Sans, sentence case (`docs/UI_PLAN.md` §1–2). New UI reuses `.empty-card`, `.segment`/`.seg`, `.btn-*`, `.kv`, `.toast`, and the existing tokens (`--color-danger`, `--color-warning`, `--color-accent`). There are no new colors, fonts, or frameworks.
- **Performance contracts that stay as they are**:
  - The idle-frame contract: anything that changes the image sets `SceneHost.viewDirty` or keeps `navigation.isMoving()` true. New status UI reads stats in `renderPerf` (every 0.4 s) and never forces a draw.
  - LoD stays off unless `?lod=force` or a paged `.rad`.
  - The planner (`planGaussianDecode`), `DECODE_FRACTION`, the mobile Spark options, the watchdog `stallFor` timings (90 s, or 10 min in the GPU stage), the `large` pre-clear, and the pick-index pump rates are unchanged unless a batch says otherwise.
- **Storage**: keep the `3dviewer-` prefix and the `writeStorage()` and try/catch pattern. The new keys are `3dviewer-quality`, `3dviewer-inflight`, and `3dviewer-upright`.
- **Element IDs** in `docs/UI_PLAN.md` §8.6 keep their element types. Moving one to another settings section is allowed.

## Correction to the brief: what "today's default" is

On desktop, `detectMemoryBudget` gives `maxSh: 3` (`src/core/memoryBudget.ts:49`), and `ViewerApp` starts `settings.shDegree` at `budget.maxSh` (`ViewerApp.ts:52-55`). "SH 2" is what the planner chooses for the owner's 14,161,020-splat SH3 scan: extended SH3 needs 16,777,216 padded slots × 96 B = 1.61 GB, which does not fit 0.62 × 1.76 GiB ≈ 1.17 GB. Extended SH2 does fit (1.07 GB; see BENCHMARK.md). Mobile caps SH at 1. LoD is off everywhere. **Automatic is defined as exactly this policy**: up to SH 3 on desktop and SH 1 on mobile, stepped down to fit memory, with no LoD. It is not a hard cap of 2.

---

## Batch 1: The app shell starts without graphics, and errors say what to do next

### Problem

- `ViewerApp`'s constructor (`src/app/ViewerApp.ts:48-94`) calls `new SceneHost` (`:56`) before `bind()` (`:82`). `SceneHost` throws when `getContext('webgl2')` returns null (`src/render/SceneHost.ts:92-97`). The `catch` in `src/main.ts:26-38` then writes the message into the empty card, but no handler is wired. Help, Download, Settings, the URL dialog, and the empty-state buttons do nothing.
- `main.ts` also waits up to 8 s for `navigator.serviceWorker.ready` before it constructs anything. On a cold visit the whole toolbar is dead for that long.
- Load errors end up as one string in a toast (`explainLoadError`, `ViewerApp.ts:589`). The gaussian loader wraps errors in `new Error(explainLoadError(error))` (`gaussianLoader.ts:262, :319, :334, :424`), which drops the original error's `name`. There is no next step and no diagnostics.

### Changes

1. **The shell starts before graphics.**
   - `src/main.ts`: construct `ViewerApp` synchronously, which wires the shell. Then call `app.initGraphics()` immediately. Only `app.boot()` waits for `waitForServiceWorker()`, because the service worker only gates the first sample fetch. Keep a last-resort `try/catch` that calls `renderProblem()` from `src/ui/problem.ts`, not raw `textContent`.
   - `ViewerApp`:
     - `private host: SceneHost | null = null`.
     - Add a getter `items` that returns `this.host?.items ?? []`. `renderSceneInfo`, `renderFileChip`, `syncShDegree`, `syncApplicable`, `renderPerf`, and `load`'s `large` check use it.
     - The constructor keeps `settings`, `bindRangeFills`, `syncControls`, `bind()`, the theme, the HUD, and `renderSceneInfo()`.
     - `restoreNavPrefs()` stores the up mode and sensitivity in fields. `initGraphics()` applies them.
   - `ViewerApp.initGraphics(): boolean`:
     - Inside a `try`, it runs everything the constructor did with the host: `new SceneHost`, the context-loss handlers, `setBackground`, `applySettings`, the nav prefs, and `host.start(...)`. On success it removes `body.no-graphics`.
     - On failure it adds `body.no-graphics` and calls `showProblem(classifyFailure(error))`.
     - The graphics problem's **Try again** button calls `initGraphics()` again. `settings` and the nav prefs survive, because `ViewerApp` survives.
   - Every `this.host.x` call site becomes `this.host?.x`. These are the mode, focus, reset, grid, settings handlers, `setFlip`, `setUpMode`, and the R/F/1/2/G keys. Strict TS finds them all.
   - `load()` and `loadDemoSlab()` return early with the graphics problem when `host` is null. When that happens on boot, keep `?url=` in the report.
   - `src/styles.css`: `body.no-graphics #toolbar, body.no-graphics #hud { display: none; }`. The Open buttons stay visible. While there is no graphics, clicking one re-shows the problem card instead of the file picker.
   - `SceneHost` constructor:
     - Throw `GraphicsUnavailableError` (new, in `src/core/loadFailure.ts`) with `reason: 'no-webgl2' | 'renderer-failed'` and the `statusMessage` from a `webglcontextcreationerror` listener attached before `getContext`.
     - Wrap `new THREE.WebGLRenderer` and `new SparkRenderer` the same way.
     - Add a `get rendererInfo(): { renderer?: string; vendor?: string; maxTextureSize: number; software: boolean }` getter. It reads `WEBGL_debug_renderer_info` from the existing context and sets `software` when the renderer string matches `/SwiftShader|llvmpipe|Software|Basic Render/i`.
   - After a successful init on a software renderer, show a one-time `warn` toast: "Graphics are running in software mode, so large scenes will be slow. Turn on hardware acceleration in your browser settings."

2. **Failure classification**: new pure module `src/core/loadFailure.ts`.
   - Types:
     - `type FailureKind = 'graphics' | 'format' | 'memory' | 'network' | 'stalled' | 'cancelled' | 'unknown'`.
     - `classifyFailure(error: unknown, context?: { source?: AssetSource; stage?: LoadProgress['stage'] }): Failure`, where `Failure` is `{ kind, title, body, actions: FailureAction[], raw: string }` and `FailureAction` is `'retry' | 'retry-lower-memory' | 'choose-file' | 'open-file' | 'download-app' | 'reinit-graphics' | 'formats'`.
   - The classifier walks the `cause` chain. Rules, in order:
     - `AbortError` with no custom reason → `cancelled` (keep today's info toast; no card).
     - `LoadStalledError` (new class) → `stalled`. `ViewerApp.load`'s `stall()` (`:525-527`) throws it instead of a plain `Error(stallMessage(...))`, with the same text.
     - `GraphicsUnavailableError` → `graphics`.
     - `RangeError`, or a `RuntimeError` name, or `/unreachable|out of bounds|out of memory|allocation failed|Invalid array length/i` → `memory`.
     - `TypeError` with `/Failed to fetch|NetworkError|Load failed|network/i`, or `/Could not (download|read) .* \((\d+|network)\)|Range request returned/` → `network`. The sub-text comes from the status: 401 or 403 means access denied, 404 means not found, and a cross-origin URL with no status means "blocked by CORS or offline" (it also checks `navigator.onLine`).
     - `GaussianPlyError`, `/Unsupported file/`, `SyntaxError`, `/GLTFLoader|PLY|header/i`, or any other error raised in the `parse` stage → `format`.
     - Anything else → `unknown`. That card shows the same text as today plus diagnostics, so it is never worse than today.
   - Pass `{ cause: error }` at the four wrap sites in `gaussianLoader.ts`. Keep `explainLoadError` as the human text in `raw`.

| Kind | Title | Next steps (actions) |
| --- | --- | --- |
| graphics | "Graphics are not available" | Turn on hardware acceleration and reload (inline steps for Chrome, Edge, Firefox, and Safari), Try again, Download desktop app |
| format | "This file could not be read" | "It may be incomplete (still copying or syncing) or a variant Omniview does not read." Choose another file, Supported formats |
| memory | "Not enough memory for this scene" | Try again with lower memory, Get the desktop app, "Close other tabs" hint. The body names the file size and `deviceMemory` |
| network | "Could not download the file" | Try again, Open a local file instead. Status, host, and a CORS hint are in the body |
| stalled | "Loading stopped responding" | Try again. Keep the `.rad` hint from `stallMessage` |

3. **Diagnostics and report**: new `src/core/diagnostics.ts`.
   - `collectDiagnostics(host?: SceneHost | null, load?: LoadDiag): Diagnostics`:
     - App: build (`__APP_BUILD__`), desktop app or PWA (`isDesktopApp()`, `display-mode: standalone`).
     - Browser: UA, `userAgentData.brands` if present, platform, language.
     - Graphics: WebGL2 yes or no, WebGL1 yes or no (probed on a throwaway 1×1 canvas only when there is no host, then released with `WEBGL_lose_context`), renderer and vendor, max texture size, software flag, creation `statusMessage`.
     - Memory: `deviceMemory`, `hardwareConcurrency`, `performance.memory.jsHeapSizeLimit` when present, budget profile, and `cpuBytes`.
     - Load: name, extension, size, origin, **URL host only** (no path or query), stage, elapsed, and preset.
     - Error: name and message chain.
   - `formatReport(d): string` is pure, uses one `Key: value` per line, and starts with `Omniview <build>`.

4. **Problem card**:
   - `index.html`: add `<section id="problem" class="empty problem" hidden role="alert" aria-labelledby="problem-title">`, using the `.empty-card` markup. It holds an icon `<use>`, `#problem-title`, `#problem-desc`, and `#problem-actions`, plus `<details id="problem-details"><summary>Diagnostics</summary><pre id="problem-report" class="kv-mono"></pre><button id="problem-copy">Copy report</button></details>`. Add `#problem-close` ("Back") when a scene or the start screen is behind it.
   - Also add `#toast-action` (a `btn-ghost btn-sm`) inside `#toast`.
   - `src/ui/problem.ts`: `renderProblem(root, failure, report, handlers)` builds the buttons from `failure.actions`. **Copy report** uses `navigator.clipboard.writeText`. When that fails (Tauri or an insecure context), it selects the `<pre>` text and shows "Press Ctrl+C to copy".
   - `ViewerApp.showProblem(failure)`:
     - When nothing is loaded, it shows `#problem` in place of `#empty`. One `setSurface('empty' | 'problem' | 'none')` decides which of the two is visible.
     - When a previous scene is still on screen (a failed small load), it shows an error toast with a **Details** action that opens the card over the scene.
     - The `retry` actions call `load(source)` again with the retained `AssetSource`, which still holds the `File` object for local files.

5. **Recover without losing the view**:
   - `src/render/Navigation.ts`: add `snapshot(): NavSnapshot` (camera position, pivot, up, and mode) and `restore(s)` (copy, `camera.up`, `lookAtPivot()`; no animation).
   - `ViewerApp.onContextRestored` (`:60-76`) and the `retry` actions take a snapshot before `load()`. After a successful load of the same source (same name, size, and origin), they call `restore` after `setFlip`/`frameAll`.
   - Orientation (`flipY`, the up mode, and the Batch 4 upright state) lives in `settings` and storage, so it survives anyway.
   - If the context is lost and not restored within 10 s, show the graphics problem with **Reload viewer**.

6. **Crash breadcrumb**, for a tab that runs out of memory and gets no JS callback:
   - `load()` writes `3dviewer-inflight` = `{ name, size, origin, url?, at }` before the probe, when the size is at least 64 MB or unknown. It clears the key in `finally`, and also in a `pagehide` listener, so a normal tab close does not leave it.
   - On construct, a key younger than 24 h shows the memory card: "Omniview closed while opening *name* (2.3 GB). That usually means it ran out of memory." Its actions are Try again with lower memory (choose the file again for local files; retry directly for URLs and samples), Get the desktop app, and Dismiss.
   - **Try again with lower memory**, in this batch: re-run `load()` with the per-load override `{ maxSh: 0 }` merged into `gaussianOverrides`, and always pre-clear the previous scene. Batch 2 replaces this with "switch to the Lower memory preset".

### Acceptance

- With WebGL2 forced off, Help, Download, Settings, the theme, the URL dialog, and the empty-state buttons all respond. The problem card shows the title, next steps, and diagnostics within 1 s of load, and there are no `pageerror` events.
- With the service worker blocked, Help opens less than 2 s after navigation. Today it takes 8 s.
- A corrupt `.ply`, a 404 or failed fetch, and a stall each show their own card with a working primary action. Cancel still shows only the "Loading cancelled." info toast.
- After a simulated context loss and restore on the torus sample, the camera position and pivot match the values from before the loss, within 1e-6.
- The `smoke.spec.ts` and `download.spec.ts` specs pass unchanged.

### Tests

- Unit: `tests/loadFailure.test.ts`. It is table-driven over real Chrome, Firefox, and Safari messages: `TypeError('Failed to fetch')`, `TypeError('NetworkError when attempting to fetch resource.')`, `TypeError('Load failed')`, `Could not download x.ply (404)`, `RangeError('Array buffer allocation failed')`, a `RuntimeError`-named "unreachable", `GaussianPlyError`, a wrapped error whose `cause` is a `RangeError`, `LoadStalledError`, `GraphicsUnavailableError`, and an `AbortError`. It asserts the kind and the action list.
- Unit: `tests/diagnostics.test.ts`. `formatReport` strips the URL path and query, keeps the host, and prints `WebGL2: no` and `Software renderer: yes` correctly.
- Unit: `tests/navigation.test.ts`. No test constructs `NavigationController` today, because it needs `window` and DOM listeners. Put the logic in a pure exported `applySnapshot(camera, pivot, s)` in `Navigation.ts`, which `restore` calls, and test a round trip on a bare `PerspectiveCamera`.
- E2E: new `tests-e2e/recovery.spec.ts`.
  - **Forced WebGL2 failure**: `page.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...rest) { return type === 'webgl2' ? null : get.call(this, type, ...rest); }; })`. Expect `#problem-title` to have the text "Graphics are not available". Then click `#help-btn` and check `#help-dialog` is visible, press Escape, click `#download-btn` and check `#download-dialog` is visible, click `#panel-btn` and check `#panel` does not have the class `is-collapsed`. Open `#problem-details`, check `#problem-report` contains `WebGL2: no`, and with clipboard permissions granted, **Copy report** puts text starting with `Omniview` on the clipboard. Expect no `pageerror`.
  - **Service worker blocked**: `test.use({ serviceWorkers: 'block' })`, then `#help-btn` opens the dialog within 2000 ms.
  - **Corrupt file**: `page.route('**/bad.ply', r => r.fulfill({ body: 'ply\nformat binary_little_endian 1.0\nelement vertex 1000\nproperty float x\nend_header\n\x00' }))`, then `?url=.../bad.ply` shows the format card with **Choose another file**.
  - **Network**: `page.route('**/gone.ply', r => r.abort('failed'))` shows the network card. Clicking **Try again** requests the URL a second time, which the test checks with a route hit counter.
  - **Breadcrumb**: an init script sets `3dviewer-inflight` to a 2 GB entry, and the page shows the memory card. **Dismiss** clears the key.

### Risks

- About 30 `host` call sites become nullable. A missed guard throws only in the no-graphics state, and the forced-failure e2e exercises every toolbar and shortcut path.
- Message-based classification is brittle across browsers. Unknown errors fall back to today's text plus diagnostics, and the table test pins known strings.
- The report could leak private URLs. Only the host is included, and the report text is shown in full before copying.
- A breadcrumb can be a false positive when the browser is killed on purpose. The card is dismissible, never auto-retries, and expires after 24 h.

---

## Batch 2: Quality presets

### Design

New pure module `src/core/qualityPreset.ts`:

- `type QualityPreset = 'auto' | 'quality' | 'memory'`.
- `resolvePreset(preset, budget): PresetPlan`, where `PresetPlan` is `{ budget: MemoryBudget; overrides?: GaussianLoadOverrides; renderSh: ShDegree; pixelRatio: RenderSettings['pixelRatio']; extendedPrecision: boolean; alwaysPreClear: boolean; summary: string }`.

| Preset | Decode | Render | Peak-memory levers |
| --- | --- | --- | --- |
| **Automatic** (default) | `budget` unchanged, no overrides | `renderSh = budget.maxSh`, pixel ratio `auto` | Today's `large` pre-clear rule |
| **Better quality** | `budget.maxSh = 3` on every profile, so mobile can rise above 1 when memory allows. `extendedPrecision = true` (float32 centers even below 80 MB) | `renderSh = 3`, pixel ratio `auto` on desktop and `2` on mobile | Same as Automatic. The planner still fits memory and never exceeds the budget |
| **Lower memory** | `overrides.maxSh = 1` on desktop and `0` on mobile. `cpuBytes × 0.7`. Mobile `maxSplatsResident × 0.6` | `renderSh` equals the decode cap, pixel ratio `1` | Always pre-clear the previous scene before decode. LoD is never built |

- **Automatic on desktop equals today, by construction.** It returns the same `budget` object with no overrides. It does not switch on GPU hints: WebGL has no GPU-memory query, and renderer strings are masked or bucketed in Firefox and Safari. Device memory and the mobile UA already feed `detectMemoryBudget`. A software renderer only adds the Batch 1 suggestion toast.
- **Better quality on desktop** decodes the same as Automatic for any file that fits at SH 3. For the 14.2M scan it still gets extended SH 2, because extended SH 3 needs 1.61 GB. The summary line says so. Better quality does not fall back to packed SH 3: half-float centers quantize to about 0.25 m at ±300 m (`docs/NAV_MOTION_PLAN.md`).
- **Lower memory** for the 14.2M scan at `deviceMemory: 8` is extended SH 1, stride 1, 805,306,368 B. That fits 0.7 × 1.17 GB, against 1.07 GB today, so the peak drops by about 25%, before also counting the pre-clear.
- **LoD in Lower memory**: `createLodSplats` keeps the base arrays and adds a copy, (1 + R) × base (NAV_MOTION_PLAN §Batch 2), so LoD never lowers memory in Spark 2.2. The memory math never allows it. A paged `.rad` remains the bounded-memory route and is mentioned in the hint.
- Spark-decoded formats (`.spz`, `.sog`, `.splat`, `.ksplat`, `.rad`) only get the render SH, pixel ratio, and pre-clear levers, because Spark decodes them itself. The hint says so.
- If NAV_MOTION_PLAN Batch 2 lands later, its `policy` maps from the preset: Automatic → `auto`, Better quality → `quality`, and Lower memory never uses `speed`. Do **not** add its separate `#large-scenes` select. A fourth preset ("Smoother motion") would carry `speed`.

### Changes

- `src/core/types.ts`: export `QualityPreset`. Add `quality: QualityPreset` to `RenderSettings`, with `'auto'` in `DEFAULT_SETTINGS`.
- `ViewerApp`:
  - The constructor reads `3dviewer-quality`; an invalid value becomes `auto`. It calls `applyPreset(resolvePreset(...))`, which sets `settings.shDegree`, `pixelRatio`, and `extendedPrecision`, then calls `syncControls()`.
  - `load()` passes `plan.budget` (instead of `detectMemoryBudget()`, `:564`) and `{ ...this.gaussianOverrides, ...plan.overrides }`; URL overrides win. The `large` check becomes `plan.alwaysPreClear || large`.
  - Changing the preset with a scene loaded applies render SH and pixel ratio live. Decode changes need a reopen, so the panel shows `#quality-reopen`, "Reopen to apply memory changes", which calls `load(lastSource)`.
  - The Batch 1 memory action becomes "Switch to Lower memory and try again". It persists the preset and shows the toast "Lower memory is on. Change it in Settings." If Batch 1 has not landed, skip this item.
- `index.html`:
  - At the top of `#sec-display`, add `<div class="field" id="quality-field">` with a `.segment` of three `.seg` buttons (`#quality-auto`, `#quality-quality`, `#quality-memory`, `role="radio"` in a `role="radiogroup"`), `<p id="quality-summary" class="hint">`, and `#quality-reopen` (hidden).
  - The summary text comes from `plan.summary`, for example "Desktop · up to SH 3 · level of detail off".
  - **Move to `#sec-advanced`**: `#sh-degree` and `#splat-scale` from Display, and `#lod-scale` and `#pixel-ratio` from Performance, above the existing 2D axes, radial sort, and extended precision switches.
  - Display keeps Quality, Point size, Shading, Wireframe, and Ground grid. Performance keeps the stats switch and `#perf-info`.
  - The Advanced controls are live overrides; changing the preset resets them to the preset's values. Only the preset persists, which matches today, where none of these controls persist.
- `src/styles.css`: a full-width segment inside the panel (`.panel .segment { width: 100%; } .panel .seg { flex: 1; }`). There are no new tokens.

### Acceptance

- On a desktop UA with no stored preset, `settings`, the `LoadContext` budget, and the overrides are deep-equal to `main`. The 14.2M plan is still extended SH 2, stride 1, `lod: false`.
- The selected preset persists across a reload. Lower memory on the torus sample, followed by **Reopen**, shows the Scene row "sh 1 of 3".
- Advanced holds SH degree, Splat cutoff, LOD detail, Pixel ratio, 2D axes, Radial sort, and Extended precision. Display no longer shows SH degree.

### Tests

- Unit: `tests/qualityPreset.test.ts`.
  - `resolvePreset('auto', desktop8)` returns the same `budget` reference and `overrides: undefined`.
  - Planner snapshots for 14,161,020 splats at SH 3 with `preferExtended: true`: `auto` and `quality` give extended SH 2 at 1,073,741,824 B; `memory` gives extended SH 1 at 805,306,368 B, stride 1. The mobile 4 GB `memory` result has `shDegree === 0` and `decodedCount <=` the `auto` count.
  - `lod` is false for every preset without `?lod=force`.
  - An invalid stored string parses to `auto`.
- E2E: `tests-e2e/presets.spec.ts`.
  - Open Settings, click `#quality-memory`, reload, and check it has `aria-checked="true"`.
  - `#sh-degree` is inside `#sec-advanced`.
  - Load `?sample=torus-ply`, switch to Lower memory, click `#quality-reopen`, and check `#scene-info` contains `1 of 3`.

### Risks

- `cpuBytes × 0.7` subsamples some mid-size files that load at stride 1 today. That only happens in Lower memory, and the existing note announces it.
- Moving controls can break the owner's muscle memory. The IDs are unchanged and the Advanced section is one click away. Refresh the `ui-shots` baseline.
- Better quality on mobile allows SH 3 and pixel ratio 2, which costs more GPU fill. It is opt-in, and the summary states the cost.

---

## Batch 3: Loading stages, progress, and stall hints

### Model

The loading card shows two steps, **Reading file** and **Preparing scene**. After the card closes, a badge on the file chip shows **Interactive preview** while the scene still refines, then **Full quality** for 2 s before it hides. Scenes with nothing to refine (meshes, small clouds) never show the badge.

- `src/core/types.ts`: add `phase?: 'reading' | 'preparing'` and `bytes?: { loaded: number; total?: number }` to `LoadProgress`. Without a `phase`, the mapping is `detect` and `download` → reading, and `parse` and `gpu` → preparing.
- New pure module `src/ui/loadPhase.ts`:
  - `phaseOf(progress)`.
  - `progressLine(progress, source)` returns "1.1 GB of 2.3 GB · 48%" for reading, the loader message for preparing, and no fake percent during the GPU step.
  - `stallHint({ phase, stage, origin, host, idleMs, splats })` returns null below `STALL_HINT_MS = 10_000`, or below 20,000 in `gpu`, the current threshold. Above the threshold it returns:
    - Reading a remote file: "No data from *host* for 14 s. The server or connection may be slow. You can keep waiting or cancel."
    - Reading a local file: "The browser has not read more of the file for 14 s. Files on network or cloud-synced drives can pause while they download."
    - Preparing, decode: "Still decoding. Compressed formats (.spz, .sog) decode in one step and do not report progress."
    - Preparing, GPU: "Uploading *N* splats to the GPU in one step. The page can freeze until it finishes; Cancel applies right after."

### Changes

- **Byte progress where it is missing today**:
  - New `src/core/fetchProgress.ts` with `fetchBlobWithProgress(url, signal, onBytes)`. It reads `res.body`, reports `{ loaded, total: content-length }`, and folds chunks into a `Blob` every 32 MB (`blob = new Blob([blob, ...chunks])`), so Chrome can keep large blobs on disk and the peak stays near today's `res.blob()`.
  - Use it in `blobOf` in `gaussianLoader.ts:43-51` and `pointCloudLoader.ts:13-14`.
  - `decodeGaussianPly.ts` `report()` (`:337-346`): add `bytesRead = headerBytes + scanned × stride`. `gaussianLoader` forwards it as `bytes` with `phase: 'reading'` when the input is a local `File` or a range URL, because reading and decoding interleave there. For a blob that is already downloaded, it sends `phase: 'preparing'`.
- **Cancel in every stage**:
  - `loadViaSpark` (`gaussianLoader.ts:383`): for a URL that is not `.rad` and has a known size, fetch with `ctx.signal` and pass `options.stream` and `streamLength`, as the `File` path already does. Abort then stops the network, and the stream also gives byte progress. `.rad` keeps `options.url`, because the pager needs ranges.
  - `loadDemoSlab` gets its own `AbortController`, so Cancel shows on the slab too.
  - A single synchronous GPU upload cannot be interrupted. `cancelLoad` already hides the card at once and bumps `generation`, and `disposeIfAborted` frees the work afterwards. The GPU stall hint states this.
- `ViewerApp`:
  - Track `lastProgressAt` and `lastLoaded`; they update only when `loaded` or `bytes.loaded` changes.
  - `renderElapsed()` (`:693-710`) calls `stallHint` and writes `#loading-detail`, replacing the hard-coded GPU note at `:704-709` and `:770-775`.
  - `setLoading` and `renderLoadingSteps` (`:712-815`) switch to `phaseOf`. The steps `<ol>` in `index.html:279-283` becomes two items, `data-step="reading"` ("Reading file", or "Downloading" for URLs) and `data-step="preparing"` ("Preparing scene"). `#loading-sr` reads "Reading file, step 1 of 2".
  - Keep elapsed time after 3 s, the bar rules, and every bound ID.
- **Refinement badge**:
  - `SceneHost.refinement(): { pending: boolean; index: number | null; paging: boolean; sorting: boolean }`.
    - `index` is `indexJob?.progress`.
    - `paging` is `pagerPending()`.
    - `sorting` is true until the first Spark sort completes after `add()`: record `lastSortTime` at add time, and check that it changed and `(spark as …).sorting` is false, with the same duck-typing as `pagerPending`.
  - `ViewerApp.renderPerf` updates `#file-quality`, a `.badge` inside `#file-chip`, with "Interactive preview" and the title "Building pick index 43% · sorting 14.2M splats". When nothing is pending, it switches to "Full quality" with `#i-check` and hides after 2 s.

### Acceptance

- A local 2.3 GB PLY shows "Reading file", byte counts, and a percent that matches the decode progress. A URL load shows download bytes for every loader path except `.rad` and servers that send no `content-length`, which get bytes with no percent.
- After 10 s with no progress, the stage-specific hint appears, and it clears when progress resumes.
- Cancel in the Reading and Preparing (decode) stages hides the card within 250 ms of the click, aborts the request, and terminates the worker.
- On the slab demo at 1.5M, the badge goes from Interactive preview to Full quality once the pick index reaches "ready".
- The `smoke.spec.ts` contract still holds: `#loading` is hidden when the load finishes.

### Tests

- Unit: `tests/loadPhase.test.ts`: the stage-to-phase table, the `phase` override, `progressLine` formats, `stallHint` thresholds (9,999 → null; 10,000 → text; GPU uses 20 s), and remote and local wording.
- Unit: `tests/fetchProgress.test.ts`: a `Response` with a `ReadableStream` of 5 chunks reports increasing bytes and a final total. An aborted signal rejects with `AbortError`. The `Blob` size equals the sum of the chunks.
- Unit: extend `tests/gaussianPly.test.ts` so the decode progress `bytes` ends at `header + count × stride`.
- E2E: `tests-e2e/loading.spec.ts`.
  - **Stall hint**: `page.clock.install()`, then `page.route('**/hang.ply', () => {})`, which never fulfills. `?url=…/hang.ply` shows the `[data-step="reading"]` step as `is-active`. `clock.fastForward(12_000)` makes `#loading-detail` contain "No data from".
  - **Cancel while reading**: on the same hanging route, clicking `#loading-cancel` hides `#loading` within 500 ms, and `page.on('requestfailed')` sees `hang.ply`.
  - **Cancel while preparing**: the test generates a 200,000-splat SH 0 gaussian PLY in Node (about 12 MB) and serves it with `route.fulfill`. It waits for `[data-step="preparing"].is-active`, clicks Cancel, and expects `#loading` to be hidden within 500 ms, `#file-chip` to be hidden, and no `pageerror`.
  - **Badge**: on `?demo=slab&n=300000`, `#file-quality` eventually has the text "Full quality" and then becomes hidden.

### Risks

- Spark's `stream` option on URL loads replaces `options.url` for those formats. The torus `.splat` e2e covers the path, and `.rad` is excluded.
- `blob` folding could double the peak on some browsers. Compare against `res.blob()` in Chrome Task Manager on a 1 GB `?url=` load and record the result in BENCHMARK.md. If it is worse, fall back to `res.blob()` above 1 GB and keep only the byte counter.
- The `sorting` signal reads Spark internals that are not public. If the field is missing, `sorting` is false and the badge depends only on the index and paging.

---

## Batch 4: Make upright

### Design

A **Make upright** button (`#upright-btn`, a new Lucide `axis-3d` symbol in the sprite) sits in the bottom toolbar after Reset. It opens `#upright`, a small `.island` panel above the toolbar, positioned and offset like the toast stack, with these controls:

- **Turn 90°**: three rows labeled X, Y, and Z. Each row has a small colored axis dot (`#e5484d`, `#46a758`, `#3e8ed0`, used only as the dot) and ↺ / ↻ buttons. They rotate the scene about its center, around world axes.
- **Level from ground**: a toggle. While it is on, the canvas cursor is a crosshair. A click (moving less than 4 px and lasting less than 400 ms, so drags still orbit) levels the scene on the patch under the cursor. Drags keep navigating, so there is no `Navigation` change.
- **Undo** (also Ctrl+Z while the panel is open), **Reset** (back to the orientation from the file), and **Done**.
- One status line, for example "Turned 90° from file" or "Leveled, 7.2° tilt removed".

The up-axis select (`#up-axis`, `#up-using`) and **Flip Y** move from View and navigation to Advanced. View and navigation gets a **Make upright…** button that opens the same panel.

### Changes

- New pure module `src/render/upright.ts`:
  - `fitPlane(points: Float32Array): { normal: Vector3; rms: number; count: number } | null`. It is PCA: the smallest eigenvector of the 3×3 covariance, computed with Jacobi iterations. It returns null below 8 points or when the patch is degenerate, meaning collinear points whose two smallest eigenvalues are both under 1e-9 of the largest.
  - `levelRotation(normal, towardCamera, up): Quaternion`. It orients the normal to the side the camera sees, then calls `setFromUnitVectors(normal, up)`.
  - `quarterTurn(axis, sign)`.
  - `snapOrientation(q)`: when q is within 0.01° of one of the 24 axis-aligned rotations, it snaps to it, so repeated turns do not drift.
  - `orientationLabel(q)`.
  - `robustBox(points, lo = 0.01, hi = 0.99)`.
  - `uprightKey(source)`: `name|size` for files, the URL for remote sources.
  - `readUpright` and `writeUpright` on one `3dviewer-upright` JSON map `{ [key]: { q: [x, y, z, w], up, at } }`, capped at 32 entries with the oldest dropped first.
- `SceneHost`:
  - `setOrientation(q, up)` applies the rotation on `this.content` about the identity-orientation bounds center (`content.quaternion = q; content.position = c − q·c`). It pins `navigation.up = up` while q is not the identity. `setFlip(on)` (`:213-221`) becomes `setOrientation(on ? FLIP : I, upMode)`, so Flip Y and the turns compose in one place.
  - `frameAll` (`:236-259`): when the orientation is not the identity, compute the box for `isFlatScene` and the grid from `robustBox(collectCoarsePoints(content))`, not from the item AABBs. Without this, a leveled 10° tilt inflates the world AABB thickness from about 77 m to about 280 m on the 590 m scan. That breaks the flat test, which turns off the ground-plane pick, the pitch floor, and ground-grab pan.
  - Restart the index with a 600 ms debounce after the last orientation change: `indexAfter`, checked in the frame loop before `startIndex`. Several quick turns then rebuild the 14M index once, and picks use the coarse surface meanwhile.
  - `sampleGround(clientX, clientY): Float32Array`. It runs 25 `pick()` calls on a 5×5 grid within 32 px (the pick is pure; results are copied) and keeps only `kind === 'surface'` hits.
- `ViewerApp`:
  - `openUpright()`, `turn(axis, sign)`, `levelAt(x, y)`, `undoUpright()`, `resetUpright()`. The history stack holds up to 20 `{ q, up }` states. The level target is `host.upAxis` when the panel opens.
  - Level outcomes: when `fitPlane` returns null or `rms > 0.15 ×` the patch radius, show the info toast "That spot is not flat enough. Try a road, floor, or field." When the tilt is under 0.5°, show "Already level."
  - Write `3dviewer-upright` after each change. On load success, apply the stored entry before `frameAll` and show the info toast "Restored your upright setting for this file." with a **Reset** action, using `#toast-action` from Batch 1 (if Batch 1 has not landed, add that button in this batch).
  - Reset deletes the entry. Sample `flipY` is the "from file" base.
  - Add an **Orientation** row in the Scene info (`renderSceneInfo`, `:989`) with `orientationLabel`.
- `index.html`, `src/styles.css`: the panel markup and `.upright` styles (an island, `.btn-icon` grid, and the status line). Add a Help dialog entry under Mouse: "Make upright: toolbar → turn or click the ground". The phone layout uses the same island, full width minus the inset.

### Acceptance

- On a Z-up scan opened as Y-up, the scene becomes upright with one level click on the ground or one X turn. Orbit, the ground-plane pick, and ground-grab pan behave as for a natively flat scan, because `isFlatScene` is true after leveling.
- Undo restores the previous state exactly. Reset restores the file orientation. Reopening the same file restores the setting and shows the toast.
- Four presses of the same turn give exactly "As in file". Turning on the 14M scene triggers a single pick-index rebuild once the user stops pressing.
- Navigation outside the panel is unchanged, and a drag in level mode still orbits.

### Tests

- Unit: `tests/upright.test.ts`.
  - `fitPlane` recovers a plane tilted 7° with ±1% noise to within 0.5°, returns null for collinear points and for fewer than 8 points, and the sign follows `towardCamera`.
  - `levelRotation` maps the normal to `up` within 1e-9.
  - Four `quarterTurn('x', 1)` give the identity after `snapOrientation`.
  - `robustBox` ignores 1% outliers.
  - The storage round trip works, and the cap evicts the oldest entry.
  - `orientationLabel` gives "As in file" and "Turned 90° from file".
  - Rebuilding the 590 × 490 × 77 m slab case: tilting the points by 10° and leveling them back keeps `isFlatScene(robustBox(...))` true.
- E2E: `tests-e2e/upright.spec.ts`.
  - On `?sample=torus-ply`: click `#upright-btn`, then X ↻, and the Orientation row shows "Turned 90°". Undo shows "As in file". X ↻ again, reload the page, and the row shows "Turned 90°" plus the restore toast. Reset shows "As in file".
  - On `?demo=slab&n=50000`: turn on level mode, click the canvas center, and the toast says "Already level".

### Risks

- Moving the rotation from the item to the `content` group changes what `setFlip` rotates about (the center instead of the object origin). `frameAll` re-frames anyway. The existing flip path is covered by the torus-ply sample, which has `flipY: true`.
- Every orientation change re-sorts all splats, and Flip Y long tasks on 14M are unmeasured (BENCHMARK.md). Add an owner row: the time from a turn to a settled view on the 14M scan.
- Splat-center picks on a noisy ground give a rough normal. The 25-sample PCA with an rms gate rejects bad patches, and Undo is one click.
- Per-file keys collide for two different files with the same name and size. That is acceptable for a view preference, and Reset clears it.

---

## Summary

| Batch | Delivers | Main files |
| --- | --- | --- |
| 1 | The shell works without WebGL2 or the service worker; specific error cards with diagnostics and a copyable report; camera kept on recovery; crash breadcrumb | `main.ts`, `ViewerApp.ts`, `SceneHost.ts`, `Navigation.ts`, new `core/loadFailure.ts`, `core/diagnostics.ts`, `ui/problem.ts`, `gaussianLoader.ts`, `index.html`, `styles.css` |
| 2 | Automatic, Better quality, and Lower memory presets that persist; the Advanced section | new `core/qualityPreset.ts`, `types.ts`, `ViewerApp.ts`, `index.html`, `styles.css` |
| 3 | Reading file → Preparing scene → Interactive preview → Full quality; bytes, elapsed time, stall hints; Cancel in every stage | `types.ts`, new `ui/loadPhase.ts`, `core/fetchProgress.ts`, `gaussianLoader.ts`, `pointCloudLoader.ts`, `decodeGaussianPly.ts`, `SceneHost.ts`, `ViewerApp.ts`, `index.html` |
| 4 | Make upright: 90° turns, click the ground to level, Undo and Reset, saved per file | new `render/upright.ts`, `SceneHost.ts`, `ViewerApp.ts`, `index.html`, `styles.css` |
