# Consistency: cancel everything, open multi-file meshes, report status honestly

## Status

Planned, nothing implemented. Base: `main` at `3db2585` (after Reliability Batch 4 and the upright dismiss fix). Line numbers refer to that commit; if they moved, search for the quoted symbol.

Three batches. Each batch is one PR from a fresh branch off `main` and merges on its own. They touch some of the same files (`ViewerApp.ts`, `index.html`, `styles.css`), but the edits are in different functions, so any conflicts are textual. Where a batch reuses a helper from another batch, it says what to do if that batch has not landed. Recommended order: A → B → C.

Before each PR: `npm run lint && npm run typecheck && npm test && npm run build && npm run test:e2e`. Unit tests are pure-logic Vitest in the `node` environment (no jsdom), so new logic goes into small pure modules and DOM wiring is covered by Playwright Chromium (SwiftShader).
    10|
## Ground rules

- **Defaults stay as they are.** `resolvePreset('auto', budget)` keeps returning the same `budget` object with no overrides, so Automatic is still today's default. LoD stays off unless `?lod=force` or a paged `.rad`. The planner, `DECODE_FRACTION`, watchdog `stallFor` timings, the `large` pre-clear, the mobile Spark options, and the idle-frame contract (`SceneHost.needsDraw`) do not change. Nothing new runs in the frame loop except two counters (Batch C).
- **Visual style**: reuse `.island`, `.badge`, `.btn-*`, `.hint`, `.kv`, `.empty-card`, `.toast` and the existing tokens (`--color-warning`, `--color-accent-soft`, `--color-text-subtle`). No new colors, fonts, frameworks, or runtime dependencies.
- **Bound IDs** in `docs/UI_PLAN.md` §8.6 keep their element types (`#empty-sample` stays a `<button>`, `#file-input` stays an `<input type="file">`).
- **Storage**: one new key, `3dviewer-release`, written with `writeStorage()` and read inside try/catch.
- **Copy**: sentence case, plain words, no jargon on the first layer. Technical text goes behind a `Details` disclosure or into the Scene section.

---

    20|## Batch A: Cancel stops the work for every format; multi-file glTF and OBJ

### A1. Cancel stops the underlying work

**Problem**

- `meshLoader.load` (`src/loaders/mesh/meshLoader.ts:49-75`) awaits `loadRoot` (`:54`) before it checks `ctx.signal` (`:55`). The loaders get no signal, so a hanging `.glb`, `.obj`, or a `.gltf` whose `.bin` hangs keeps the loader pending forever after Cancel, and its requests keep running.
- On the cancelled path the code throws at `:58` after `root` exists. Nothing disposes its geometries, materials, textures, or the `ImageBitmap`s that `GLTFLoader` creates. `ViewerApp.load` only disposes late results that come back as a `Renderable` (`ViewerApp.ts:853-856`).
- `loadViaSpark` (`gaussianLoader.ts:455-541`) disposes the mesh on abort, but the loader only settles when `await mesh.initialized` (`:516`) settles. The small-file path `await source.file.arrayBuffer()` (`:488`) ignores the signal.
- The main-thread fallback `parsePlyPoints` (`pointCloudLoader.ts:120`) ignores the signal.
- The same "turn `signal.reason` into an AbortError" block is copied in four places (`meshLoader.ts:56-58`, `pointCloudLoader.ts:51-55`, `gaussianLoader.ts:97-101`, `disposeIfAborted.ts:10-12`).

three r180 supports what we need: `LoadingManager.abort()` aborts every `FileLoader` and `ImageBitmapLoader` request that uses that manager, through `AbortSignal.any`. That covers the model file, `.bin` buffers, `.mtl`, and glTF textures. `TextureLoader` (an `HTMLImageElement`, used by `MTLLoader` and by `GLTFLoader` on Safari < 17) cannot be aborted; those late images are disposed with the root.
    30|
**Changes**

1. New `src/core/abortable.ts`:
   - `abortReason(signal): Error` replaces the four copies. `disposeIfAborted.ts` keeps exporting `throwIfAborted`, now built on it, so `tests/disposeIfAborted.test.ts` is unchanged.
   - `raceAbort<T>(work: Promise<T>, signal: AbortSignal, onLate: (value: T) => void): Promise<T>`. It rejects with `abortReason(signal)` as soon as the signal aborts. If `work` resolves after that, it calls `onLate(value)` once. A late rejection is swallowed.
2. New `src/renderables/disposeObject.ts`: `disposeObject3D(root): { geometries: number; materials: number; textures: number }`. It traverses every object that has a `geometry` or `material` (meshes, `Points`, `Line*`), disposes geometries, each material once, each texture once (material properties and `uniforms[*].value`), calls `texture.source.data.close()` when the data has a `close` function (an `ImageBitmap`, as the GLTFLoader docs require), calls `skeleton?.dispose()`, then `removeFromParent()`. `MeshRenderable.dispose` (`meshRenderable.ts:140-154`) uses it after `disposeGenerated`, so loaded scenes also close their bitmaps.
3. `meshLoader.ts`:
   - `load()` creates `const manager = new THREE.LoadingManager()` and adds `ctx.signal` → `manager.abort()` (`{ once: true }`, removed in `finally`).
   - `loadRoot(extension, url, manager, companions)` passes `manager` to `GLTFLoader`, `OBJLoader`, and `MTLLoader` (A2).
   - `const root = await raceAbort(loadRoot(...), ctx.signal, disposeObject3D)`. Any throw after `root` exists (`ensureMaterials`, the `MeshRenderable` constructor) calls `disposeObject3D(root)` before rethrowing.
4. `gaussianLoader.loadViaSpark`: `await raceAbort(mesh.initialized, ctx.signal, release)` and `await raceAbort(source.file.arrayBuffer(), ctx.signal, () => {})`. The `.rad` path keeps `options.url`; `release()` on abort already disposes the mesh, which stops the pager.
5. `parsePlyPoints(source, maxPoints, onProgress, signal?)` (`src/loaders/points/parsePly.ts`) calls `throwIfAborted(signal)` once per chunk, like `decodeGaussianPly`. `pointCloudLoader.ts:120` passes `ctx.signal`.
6. `ViewerApp`:
   - `private inflight = 0`. Increment it right before `loader.load(...)` (`:841`) and decrement it in a `.finally` on the **loader promise** (not on `load()`), so a loader that never settles stays counted. Mirror it to `document.body.dataset.loads`. This is the test's "no leftover work" signal.
   - `renderPerf` (`:1755-1762`) adds a Performance row, **GPU objects**, "`12 geometries · 3 textures`", from a new `SceneHost.gpuObjects()` that reads `renderer.info.memory`. The owner can use it as a leak check too. It is only computed while the panel is open (the early return at `:1753`).
    40|
**Acceptance**

- For `.glb`, `.gltf` (with a hanging `.bin`), `.obj`, `.splat`, a gaussian `.ply`, and a point `.ply`, each served with a response that never completes: Cancel hides the card within 250 ms, `requestfailed` fires for every pending request of that load, and `body[data-loads="0"]` holds within 1 s.
- Open a hanging `.gltf`, Cancel, then open the crate sample. After three rounds there is one item, `#hud-tris` reads 12, and the GPU objects row matches a fresh single crate load.
- No `pageerror` and no console error in those runs.

**Tests**

- Unit `tests/abortable.test.ts`: `raceAbort` rejects with an `AbortError` right away when work is pending; calls `onLate` exactly once when work resolves after the abort; never calls it when work wins; surfaces a custom reason (`LoadStalledError`); a late rejection causes no unhandled rejection.
- Unit `tests/disposeObject.test.ts`: a `Group` with a two-material `Mesh` sharing one texture as `map` and `normalMap`, a `Points`, and a `SkinnedMesh`. Count `dispose` events with `addEventListener('dispose')`: the shared texture is disposed once; a texture whose `source.data` is `{ close: vi.fn() }` gets `close()` once. `MeshRenderable.dispose` gives the same counts.
- E2E new `tests-e2e/cancel.spec.ts`:
  - Table-driven over the six formats. `page.route` answers `HEAD` with a `content-length` (so `.splat` takes the `streamRemote` path) and never fulfills `GET`; the `.gltf` case fulfills a one-triangle JSON whose `scene.bin` hangs. Assert the three acceptance items.
  - Repeated Open / Cancel / Open as in the acceptance, comparing `#perf-info` with a baseline page.
    50|
### A2. Multi-file local glTF and OBJ

**Problem**

- `#file-input` takes one file (`index.html:97`), and the drop handler takes `files[0]` (`ViewerApp.ts:318`). A `.gltf` with an external `scene.bin` fails with an opaque fetch error, because the blob URL from `objectUrl` (`meshLoader.ts:6-14`) has no neighbors.
- `OBJLoader` never loads `mtllib`; it only records `materialLibraries`. So today every OBJ renders with the grey fallback material (or vertex colors), even when its `.mtl` sits next to it. OBJ support is geometry only, and the UI does not say so.

**Design**

- `src/core/types.ts`: `interface CompanionFile { path: string; file: File }` and `AssetSource.companions?: readonly CompanionFile[]`. `path` is relative: `webkitRelativePath`, the drop entry's `fullPath` without the leading slash, or the file name.
- New pure `src/core/fileSet.ts`:
  - `pickPrimary(files)` → `{ primary, companions, ignored: string[] } | null`. Priority: `glb` > `gltf` > `obj` > `rad` > `spz` > `sog` > `ksplat` > `splat` > `ply` > `zip`; ties go to the shallowest path, then the name. `ignored` lists other scene files.
  - `resolveCompanion(ref, baseDir, files)`: `decodeURIComponent`, `\` → `/`, drop `./`, resolve `..` against the primary's folder. Try the exact path, then a case-insensitive path, then a case-insensitive base name (MTL files often hold absolute paths like `C:\Users\me\tex.jpg`).
  - `gltfRefs(json)` → `{ buffers, images, required }` (skips `data:` URIs and `bufferView` images; `required` is `extensionsRequired`). `objRefs(text)` (every `mtllib` line). `mtlRefs(text)` (`map_Kd`, `map_Ks`, `map_Ke`, `map_d`, `map_Bump`, `bump`, `norm`, `disp`; skips options such as `-bm 0.5`).
  - `missingCompanions(refs, baseDir, files): string[]`.
- `src/core/sniff.ts`: `sourceFromFiles(files)` → `{ source, ignored } | null`, built on `pickPrimary`. `sourceFromFile` is unchanged, so single-file opens behave as today.
- `src/core/loadFailure.ts`: `MissingCompanionsError(missing: string[])`. `classifyFailure` maps it to `format` with the title "Files missing for this model", the body "Missing: scene.bin, textures/wood.png. Select the model together with these files, or drop the whole folder. A single .glb avoids this.", and the actions `['choose-file', 'choose-folder']`. `'choose-folder'` is a new `FailureAction`; `src/ui/problem.ts` adds the `chooseFolder` runner.
    70|
**Changes**

- `meshLoader.ts`, local `.gltf`:
  - Read the text and run `gltfRefs`. A missing buffer throws `MissingCompanionsError` before any parse.
  - An unsupported entry in `required` (Draco, meshopt, KTX2: no decoders are wired) throws "This glTF needs *KHR_draco_mesh_compression*, which Omniview does not decode yet. Export it without compression, or as .glb."
  - Then `new GLTFLoader(manager).parseAsync(text, 'local:/')`. `manager.setURLModifier` maps `local:/<ref>` through `resolveCompanion` to a blob URL created on demand.
  - A missing image maps to a 1×1 neutral PNG data URI, so `GLTFLoader` logs no error, and the load warns "Loaded without 2 textures: wood.png, metal.jpg." through `stats.extra.note` (the existing warn toast at `ViewerApp.ts:869-870`).
- `meshLoader.ts`, `.obj` (local or URL):
  - Read the text (`FileLoader(manager)` for URLs) and run `objRefs`. When an `.mtl` resolves, `new MTLLoader(manager).setResourcePath(base).parse(mtlText, base)`, then `materials.preload()`, then `new OBJLoader(manager).setMaterials(materials).parse(objText)`. `base` is `local:/` for files and `LoaderUtils.extractUrlBase(url)` for URLs.
  - A missing `.mtl` is not a failure: it loads the geometry and warns "Materials not found: model.mtl. Showing geometry only." Missing `.mtl` textures warn like glTF textures.
- `meshLoader.ts`, blob URLs: track every URL it creates in a `Set` and revoke all of them when the root settles. MTL textures load after `parse` returns, so for OBJ, revoke when the manager reports idle (`onLoad`) or on abort, whichever comes first.
- `MeshRenderable` gets a `materials` label in `stats.extra`, shown as a **Materials** Scene row: "From file" (glTF), "From model.mtl", "None (geometry only)", or "Missing model.mtl (geometry only)".
- `index.html`:
  - `#file-input` gains `multiple`, and its `accept` adds `.bin,.mtl,.png,.jpg,.jpeg,.webp`.
  - New `<input id="folder-input" type="file" webkitdirectory multiple hidden />`.
  - In `#empty`, `.empty-formats` becomes "Splats: .ply .splat .spz .ksplat .sog .rad · Meshes: .glb, .gltf with its .bin and textures, .obj (materials need its .mtl) · Points: .ply". Below it, `<p id="empty-multi" class="hint">` reads "For a .gltf or .obj with separate files, select them all, drop the folder, or <button id="empty-folder" class="btn btn-ghost btn-sm" type="button">choose a folder</button>. A single .glb is easiest."
  - The `.drop-inner` span becomes "Files or a folder: splats, meshes, or point clouds".
  - The Help dialog gets a fourth section, **Files**, with "Mesh with textures: use .glb, or select the .gltf or .obj together with its .bin, .mtl, and images (or a folder)".
  - `FORMATS` in `src/ui/problem.ts` matches the new line.
- `ViewerApp.bind()`:
  - `#file-input` change: `openFiles([...files].map((file) => ({ path: file.name, file })))`. `#folder-input` change: the same with `webkitRelativePath`. `#empty-folder` and the `choose-folder` action click `#folder-input`.
  - `drop` (`:315-323`): read `item.webkitGetAsEntry()` for every item **synchronously inside the handler**, then `await collectDropped(entries)` from new `src/ui/dropEntries.ts`. It loops `readEntries()` until it returns an empty batch, and caps depth at 8 and the count at 2,000 files. Without entries, fall back to `dataTransfer.files`.
  - `openFiles(list)`: `sourceFromFiles`. If it returns null, show the info toast "No supported scene file in that selection." If `ignored` is not empty, show the info toast "Opened a.glb. Ignored 2 other scene files: b.ply, c.obj." Then `setQuery(null)` and `load(source)`.
  - `uprightKey`, the crash breadcrumb, and retry use the primary file and keep the `companions` array, so **Try again** works.
   100|
**Acceptance**

- Picking `scene.gltf`, `scene.bin`, and `tex.png` loads a textured mesh; Materials reads "From file". Picking `scene.gltf` alone shows "Files missing for this model" listing `scene.bin` and `tex.png`, with **Choose folder**.
- `model.obj`, `model.mtl`, and `tex.png` load with the MTL color and texture ("From model.mtl"). `model.obj` alone loads the geometry and shows the warn toast.
- The folder picker and a folder drop open the same scene. Every blob URL a load creates is revoked once the load settles, or once the manager is idle for OBJ.
- `smoke.spec.ts` and `georef.spec.ts` (single `setInputFiles`) pass unchanged.

**Tests**

- Unit `tests/fileSet.test.ts`: `pickPrimary` priority, ties, and `ignored`; `resolveCompanion` for `./a.bin`, `textures%20dir/a.png`, `..\tex\A.PNG`, and `C:\abs\a.jpg` (base-name fallback); `gltfRefs` skips data URIs and returns `required`; several `mtllib` lines; `mtlRefs` with `-bm 0.5 normal.png`; `missingCompanions`.
- Unit `tests/dropEntries.test.ts`: fake directory entries whose reader returns batches of 100 then `[]`, nested folders, and the depth and count caps.
- Unit: extend `tests/loadFailure.test.ts` so `MissingCompanionsError` gives `format` with `choose-folder`.
- E2E new `tests-e2e/multifile.spec.ts`. The test builds a one-triangle glTF (with `.bin` and a 1×1 PNG) and an OBJ with an MTL in Node.
  - Picker: `setInputFiles('#file-input', [three files])`.
  - Folder: `setInputFiles('#folder-input', tmpDir)` (Playwright ≥ 1.45 uploads directories into `webkitdirectory`; the repo has 1.63).
  - Drop: build a `DataTransfer` with `page.evaluateHandle` and dispatch `drop`. A synthetic `DataTransfer` has no entries, so this covers the `files` fallback; the entry walk is covered by the unit test.
  - An init script wraps `URL.createObjectURL` and `URL.revokeObjectURL` and counts calls; after each load the two counts are equal.
   120|
**Risks**

- `AbortSignal.any` is missing before Safari 17.4 and Firefox 124. There, `manager.abort()` does not reach the `FileLoader`s that `GLTFLoader` creates internally, so those requests finish. `raceAbort` still settles the load at once and the late root is disposed.
- `GLTFLoader.parse` and `OBJLoader.parse` are CPU-bound and cannot be interrupted. Cancel returns immediately, but a large parse keeps one core busy until it ends; then its result is disposed.
- The base-name fallback can pick the wrong file when two folders hold `tex.png`. The exact path always wins first, and the shallowest path wins ties.
- Revoking blob URLs too early breaks MTL textures. That is why OBJ waits for the manager to go idle, and the counting init script tests it.

---

## Batch B: Honest status and state-aware controls

### B1. "Ready" and a separate "Reduced detail" indicator
   130|
**Problem**

`renderQuality` (`ViewerApp.ts:1332-1363`) switches the chip badge from "Interactive preview" to **Full quality** as soon as refinement completes, even when the scene was subsampled, decoded at SH 2 of 3, or forced to half-float centers. Only the Scene section's `Source` row (`:1593-1595`) and the `sh` row say so.

**Changes**

- `src/core/types.ts`: `RenderableStats.detail?: SceneDetail`, with `interface SceneDetail { sourceCount: number; retainedCount: number; sourceSh?: number; loadedSh?: number; precisionReduced?: boolean }`.
- `decodeGaussianPly` (result built at `decodeGaussianPly.ts:433-445`) adds `precisionReduced: options.preferExtended && !plan.extended`. It travels through `DecodedGaussian` (structured-cloned from the worker), `sceneInfo()` (`gaussianLoader.ts:137-154`), and `GaussianSceneInfo`.
- `GaussianRenderable.getStats` (`:61-104`) fills `detail` when `sceneInfo` exists (the PLY decode path). Spark-decoded formats leave it undefined, because their source count and SH are not known; they never show the indicator.
- `PointCloudRenderable.getStats` (`:48-62`) fills `{ sourceCount: data.sourceCount, retainedCount: data.count }`.
- New pure `src/ui/sceneDetail.ts`:
  - `detailOf(stats: RenderableStats[], renderSh: number, pixel: { used: number; automatic: number }): DetailState`, where `DetailState` is `{ reduced: boolean; retained: number; source: number; activeSh?: number; sourceSh?: number; reasons: string[] }`. Counts are summed across items; SH is the minimum.
  - Reasons, in order: "Showing 674,335 of 14,161,020 splats" (or points); "SH 1 of 3 loaded to fit memory" (`loadedSh < sourceSh`); "Rendering SH 0 (set in Settings)" (`renderSh < loadedSh`); "Half-float centers to fit memory"; "Pixel ratio 1 instead of 2" (only when the pixel ratio in use is below what Automatic would use on this device).
  - `detailText(state)` joins the reasons with " · ".
- `ViewerApp`:
  - `renderQuality` keeps its `off | preview | ready` state machine (rename `full` to `ready`). When refinement completes it shows **Ready** with `#i-check` and hides after 2 s. The string "Full quality" is removed.
  - New `renderDetail()` shows `#file-detail` while `detailOf(...).reduced`, with `title` and `aria-label` "Reduced detail: …reasons". Clicking it opens Settings at Scene. Factor `showGeoref` (`:1556-1563`) into `showSection(id)`. Call `renderDetail()` from `renderSceneInfo`, the `#sh-degree` and `#pixel-ratio` change handlers, and `applyPreset`.
  - `renderSceneInfo` (`:1565-1628`) replaces the `Source` row with a **Detail** row: "Full", or "Reduced: 674,335 of 14,161,020 splats · SH 1 of 3". It adds an **Active SH** row for splats: `min(settings.shDegree, loadedSh)` of `sourceSh`. The `sh` row stays as it is (`presets.spec.ts` reads "1 of 3").
- `index.html`: after `#file-quality` inside `#file-chip`, add `<button id="file-detail" class="badge badge-warn" type="button" hidden><svg class="icon icon-sm" aria-hidden="true"><use href="#i-info"/></svg><span class="badge-label">Reduced detail</span></button>`.
- `src/styles.css` (new classes in this plan: `.badge-warn`, `.banner`, `.sec-details`, `.btn-meta`, `.sample-card`, `.sample-thumb`, all built from existing tokens): `.badge-warn` uses `--color-warning` text on `color-mix(in srgb, var(--color-warning) 14%, transparent)`. At ≤ 640 px `.badge-label` is hidden, so the chip shows only the icon.
   150|
**Acceptance**

- On `?demo=slab&n=300000` the badge goes from Interactive preview to Ready, then hides. `rg "Full quality" src index.html` finds nothing.
- `?sample=torus-ply` has no Reduced detail badge, and Detail reads "Full".
- `?sample=torus-ply&sh=1`, or Lower memory followed by **Reopen**, shows `#file-detail` with a title containing "SH 1 of 3". Automatic followed by **Reopen** hides it.
- Setting `#sh-degree` to 0 on the torus shows the badge with "Rendering SH 0"; setting it back to 3 hides it.
- Meshes and Spark formats (`?sample=torus-splat`, `?sample=crate`) never show it.

**Tests**

- Unit `tests/sceneDetail.test.ts`: a table covering full; decode stride; SH cap at decode; SH cap at render; precision; pixel ratio; point stride; a Spark item without `detail` (not reduced); two items (summed counts, minimum SH).
- Unit: extend `tests/gaussianPly.test.ts` so `precisionReduced` is true when `preferExtended` is set and the budget only fits half-float, and false otherwise.
- E2E: `loading.spec.ts` slab test expects "Ready". New `tests-e2e/detail.spec.ts` covers the acceptance items.
   170|
### B2. State-aware UI

**Problem**

- After **Back** on the graphics problem card, the start screen looks normal, but every Open just re-shows the card (`ViewerApp.ts:195-197`). Nothing says graphics are still off; `body.no-graphics` only hides the toolbar and HUD (`styles.css:800-801`).
- With nothing loaded, Focus, Reset view, and Make upright are live. Make upright opens a panel whose buttons do nothing (`turn` returns early at `:965`). `syncApplicable` (`:1702-1716`) shows every `data-applies` field when nothing is loaded, so Point size, Shading, and Wireframe look usable.

**Changes**

- `index.html`: after `header.topbar`, add `<div id="graphics-banner" class="banner island" role="status" hidden>` with a `#i-triangle-alert` icon, the text "Graphics are unavailable, so the 3D view is off.", `#graphics-banner-details` (`btn-ghost btn-sm`, "Details"), and `#graphics-banner-retry` (`btn-secondary btn-sm`, "Try again").
- `src/styles.css`: `.banner` is centered under the top bar (`top: calc(var(--safe-top) + var(--inset) + 48px)`), `max-width: 520px`, with a `--color-warning` icon. It becomes full width minus the inset at ≤ 640 px. Its container keeps `pointer-events: none`; only the island takes input.
- `ViewerApp.syncGraphicsBanner()`: visible when `host === null && graphicsFailure !== null && surface !== 'problem'`. Call it from `setSurface` and from both branches of `initGraphics`. **Details** calls `showProblem(graphicsFailure)`. **Try again** calls `initGraphics()`, or `location.reload()` when `reloadGraphics` is set.
- New pure `src/ui/applicability.ts`: `controlState(kinds: ReadonlySet<RepresentationKind>, rule: { applies?: string[]; scene?: boolean; preload?: boolean }): 'on' | 'off' | 'hidden'`.
  - No scene: `scene` controls and `applies` controls are `off`, unless `preload` (settings that matter for the next load).
  - With a scene: an `applies` control whose kinds are absent is `hidden`; everything else is `on`.
- `index.html` markup:
  - `data-scene` on `#focus-btn`, `#reset-btn`, `#upright-btn`, and `#upright-open`.
  - `data-preload` on the Advanced splat rows (`#sh-degree`, `#splat-scale`, `#lod-scale`, `#gs-2d`, `#sort-radial`, `#extended`), which feed the next load. Point size, Shading, and Wireframe have no `data-preload`.
  - `<p id="display-empty-hint" class="hint" hidden>Open a scene first</p>` at the top of `#sec-display`.
- `syncApplicable()` is rewritten on `controlState`:
  - `off` fields get the class `is-disabled`, their input or select gets `disabled`, and they get `title="Open a scene first"`. `#display-empty-hint` shows when nothing is loaded.
  - `off` toolbar buttons get `aria-disabled="true"`, the `is-disabled` class (`--color-text-subtle`), and the title "Open a scene first". They are not `disabled`, so the tooltip and focus still work. Their click handlers, the R and F keys, and `openUpright` go through `needScene(): boolean`, which shows the info toast "Open a scene first" and returns false.
  - Section hiding (`:1708-1715`) is unchanged.
- `renderPerf` (`:1755-1762`): the splat-only rows (Sort, Active splats) are left out when no splats are loaded.
- `initGraphics` also calls `syncApplicable()`.
   200|
**Acceptance**

- With WebGL2 forced off: Back shows `#graphics-banner` on the start screen, and Details reopens the card. After the test re-allows `webgl2`, Try again hides the banner and shows the toolbar.
- On a bare `/`: Focus, Reset view, and Make upright have `aria-disabled="true"` and the title "Open a scene first". Clicking each, and pressing R and F, shows that toast, and `#upright` stays hidden. Point size, Shading, and Wireframe are disabled. Ground grid, Theme, the presets, and the Advanced splat rows stay enabled.
- On `?sample=crate`: the scene buttons are enabled, Point size and the splat rows are hidden, and Performance has no Sort row. On `?sample=torus-ply`: Shading and Wireframe are hidden.

**Tests**

- Unit `tests/applicability.test.ts`: the rule table (no scene, splats, mesh, points, and mixed kinds; `preload` and `scene` flags).
- E2E new `tests-e2e/state.spec.ts`. The banner case reuses the `getContext` init script from `recovery.spec.ts`, gated on a `window.__allowWebgl2` flag that the test sets before clicking Try again.

**Risks**

- `aria-disabled` buttons still get clicks, so every handler must go through `needScene()`. The e2e clicks each button and presses each key.
- `precisionReduced` crosses the worker boundary; `gaussianWorker.test.ts` already round-trips `DecodedGaussian`, so extend it there.
- A second badge crowds the file chip on phones. That is why it is icon-only at ≤ 640 px; check it in the `ui-shots` phone matrix.
   220|
---

## Batch C: Clear presets, sample cards, desktop version, built-in benchmark

### C1. Plain preset text with Details and the consequence for this scene

**Changes**

- `src/core/qualityPreset.ts`: `PresetPlan.summary` becomes one short sentence. Today's technical strings (`:40`, `:75`, `:94`) move verbatim into a new `PresetPlan.details`. Budgets, overrides, and render levers are unchanged.
  - Automatic: "Automatic balances detail and memory for this device. Some changes require reopening the file."
  - Better quality: "Better quality keeps more detail and uses more memory. Some changes require reopening the file."
  - Lower memory: "Lower memory keeps less detail so large scenes fit. Some changes require reopening the file."
- `index.html`, inside `#quality-field` after `#quality-summary`: `<p id="quality-consequence" class="hint" hidden></p>`, then `<details id="quality-details" class="sec-details"><summary>Details</summary><p id="quality-details-text" class="hint"></p></details>`, closed by default.
- New pure `src/ui/presetConsequence.ts`: `presetConsequence({ preset, loadedPreset, kind, detail, bytes, budget }): string | null`.
  - Nothing loaded: null, and the line is hidden.
  - A gaussian PLY with `detail` runs `planGaussianDecode` with `resolvePreset(preset, budget)`, `preferExtended = plan.extendedPrecision || bytes >= EXTENDED_BYTES` (export `EXTENDED_BYTES` from `gaussianLoader.ts`), and the preset overrides. Output: "This scan: 14,161,020 splats at SH 2 of 3, about 1.07 GB." When `preset !== loadedPreset`, it adds "Reopen to apply: SH 1 of 3, about 805 MB.", or "Reopening would not change this scan." when the plan is identical.
  - A Spark format: "This file is decoded by Spark, so only the rendered SH and pixel ratio change."
  - Points: "This point cloud: 24,000 points, all shown." (presets do not change `maxPoints`). Mesh: "Presets only change the pixel ratio for meshes."
  - It uses `detail` from Batch B. If B has not landed, read `sourcePrimitives`, `primitives`, and the `sh` extra row ("2 of 3") instead.
- `ViewerApp.syncQuality` (`:573-581`) writes the summary, details, and consequence. `renderSceneInfo` also calls it, so the line follows the loaded scene.
   240|
**Acceptance**

- With Automatic, `#quality-summary` is exactly the Automatic sentence. `#quality-details` is closed and contains "level of detail off".
- On the torus sample, the consequence reads "This scan: 4,800 splats at SH 3 of 3…". Clicking Lower memory changes it to include "Reopen to apply: SH 1 of 3".
- `tests/qualityPreset.test.ts` still shows that `auto` returns the same budget reference with no overrides.

**Tests**

- Unit: update `tests/qualityPreset.test.ts` for `summary` and `details`. New `tests/presetConsequence.test.ts`: 14,161,020 splats at SH 3 on the desktop 8 GB budget give SH 2 at 1,073,741,824 B for `auto` and SH 1 at 805,306,368 B for `memory`; plus a mobile case, a Spark item, a mesh, and nothing loaded.
- E2E: extend `tests-e2e/presets.spec.ts` with the two acceptance checks on the torus.

### C2. Sample cards with thumbnails
   250|
**Changes**

- `src/core/samples.ts`: `SampleAsset` gains `title` (short card name), `kind: RepresentationKind`, `bytes?: number` (download size; omitted for remote), and `thumb?: string`. Local sizes: `torus.ply` 326,814; `torus.splat` 153,600; `cloud.ply` 360,179; `crate.glb` 2,204; `sphere.obj` 89,606. The butterfly is remote and has no size or thumbnail.
- `index.html`: `#empty-sample` becomes the first card (still a `<button>`, still bound in `bind()`). `.empty-samples` keeps "Try a sample" as a heading above a grid.
- `buildSamples()` (`:613-633`) replaces the chips with one card per sample through `fillSampleCard(button, sample)`, using `textContent` only. Markup: `<button class="sample-card" type="button"><span class="sample-thumb" data-kind="splats"><svg class="icon icon-xl" aria-hidden="true"><use href="#i-shapes"/></svg><img alt="" width="96" height="72" loading="lazy" decoding="async"></span><span class="sample-name">Torus</span><span class="sample-meta"><span class="badge">Splats</span> .ply · 319 KB</span></button>`. The image sits on top of the icon; `img.onerror` removes the image, so the placeholder shows. A remote sample shows "Remote" instead of a size.
- `src/styles.css`: `.empty-samples` becomes `grid-template-columns: repeat(auto-fill, minmax(96px, 1fr))` with `gap: var(--space-2)`. `.sample-card` reuses the `.chip` border, radius, and hover. `.sample-thumb` is 96×72 with `--radius-md` and `--color-accent-soft` behind the icon (the placeholder). At 390 px the cards fall into three columns.
- New `scripts/render-thumbs.mjs` (`npm run thumbs`), run by hand, never in CI. It starts `vite preview`, opens Playwright Chromium with the SwiftShader args from `playwright.config.ts` at a 384×288 viewport and DPR 1, and for each local sample opens `?sample=<id>`, waits for `#loading[hidden]` plus 1.5 s, hides the chrome with `addStyleTag`, screenshots `#view`, and writes `sharp(...).resize(192, 144).webp({ quality: 70 })` to `public/samples/thumbs/<id>.webp`. The WebP files are committed, with a target of ≤ 8 KB each.
- `vite.config.ts`: add `webp` to the Workbox `globPatterns`, so the start screen is complete offline.

**Acceptance**

- A bare `/` shows six `.sample-card`s, each with a type badge, and a size for the local ones. `#empty-sample` loads the torus as before.
- Local thumbnails load (`naturalWidth > 0`). With the thumbnail route aborted, every card shows its icon placeholder and the layout does not shift.
   260|
**Tests**

- Unit: extend `tests/samples.test.ts`. Each local sample's `bytes` equals its `statSync` size, each `thumb` exists and is under 16 KB, and each `kind` matches the sniffed type of the file.
- E2E new `tests-e2e/samples.spec.ts` for the acceptance checks. Add `empty` to the `ui-shots` matrix.

**Risks**

- Thumbnails drift when the samples change. The size test catches a changed file, and the script regenerates every thumbnail.

### C3. Desktop version next to Download
   270|
**Changes**

- `vite.config.ts`: define `__APP_VERSION__` from `package.json` `version`, which is the same value `release.yml` tags (`v${version}`). Declare it in `src/env.d.ts`.
- New `src/ui/releaseVersion.ts`, pure apart from `refreshRelease`:
  - `parseLatestRelease(json): string | null` accepts `tag_name` matching `/^v?\d+\.\d+\.\d+/` and rejects drafts and prereleases.
  - `chooseVersion({ cached, now, build }): { version: string; stale: boolean }` uses a cache entry younger than 12 h, otherwise the build value with `stale: true`.
  - `readCachedRelease(storage)` and `writeCachedRelease(storage, tag, at)` work on `3dviewer-release` = `{ tag, at }`.
  - `refreshRelease(signal)` fetches `https://api.github.com/repos/ZhangAoCanada/3Dviewer/releases/latest` with `Accept: application/vnd.github+json` and a 5 s timeout.
- `index.html`: `<span id="download-version" class="btn-meta"></span>` inside `#download-btn` after its label, the same span in `#download-menu-item`, and `<span id="download-dialog-version"></span>` in `#download-title`. `.btn-meta` is muted, `--text-sm`, with tabular numerals. It hides with the label at ≤ 900 px (`styles.css:437-438`).
- `ViewerApp.syncDesktopVersion()`, from the constructor: render `chooseVersion` at once. When the entry is stale and `!isDesktopApp()`, call `refreshRelease` from `requestIdleCallback` (or a 3 s timeout), write the cache, and re-render. On any failure (offline, the 60-per-hour rate limit, CORS), keep what is shown and log nothing.

**Acceptance**

- With the API routed to `{ "tag_name": "v9.9.9" }`, the button reads "v9.9.9". With the API aborted, it reads `v` plus the `package.json` version. With a fresh cache entry, no request is made (the route hit count stays 0). The desktop app (`html.is-desktop`) makes no request.

**Tests**

- Unit `tests/releaseVersion.test.ts`: parse a release, reject drafts, prereleases, and garbage; the TTL edges; the cache round trip; a corrupt cache entry.
- E2E: extend `tests-e2e/download.spec.ts` with the three route cases.
   290|
**Risks**

- Each visitor sends one request to `api.github.com` every 12 h at most. The page already links to GitHub, and the request has no credentials.
- The build value can be ahead of the published release when the version is bumped before tagging. The API value replaces it on the first successful fetch.

### C4. Built-in benchmark report

**Entry points**: `?bench=1` runs once the boot load finishes (works with `?sample=`, `?url=`, and `?demo=slab`). The Help dialog gets a footer button, `#bench-run`, "Run benchmark on this scene", and the phone More menu gets `data-action="bench"`. With nothing loaded, the dialog says "Open a scene first, then run the benchmark." The code is in a lazy chunk (`import('../bench/runBench')`), so the main bundle grows by less than 1 KB, and nothing runs unless invoked.

**Changes**

- `SceneHost` gets read-only hooks and no behavior change: `drawStamp: { count: number; at: number }` (updated next to `drewOnce = true` at `:578`), `lastRenderMs` (the raw sample at `:572`), and `sortState(): { sorting?: boolean; lastSortTime?: number }` (the same duck typing as `sortingPending`).
- `ViewerApp` records `loadTimings = { start, added, firstDraw, ready }`: `start` in `beginLoadingClock`, `added` after `host.add`, `firstDraw` as the first `drawStamp.at` after `added`, and `ready` when `renderQuality` sees refinement finish.
- New pure `src/bench/benchStats.ts`: `percentile(sorted, p)` (nearest rank), `summarizeFrames(deltas)` → `{ count, p50, p90, p99, max, over33 }`, `formatBenchMarkdown(report)`, and the `BenchReport` type with `schema: 'omniview-bench/1'`.
- New `src/bench/runBench.ts`, `runBench(app, host, signal): Promise<BenchReport>`:
  - **Time to first usable frame**: `firstDraw - start` and `ready - start` from the boot load's `loadTimings`.
  - **Scripted orbit**: one 360° turn about the current pivot around `navigation.up` over 6 s. Each `requestAnimationFrame` rotates a `navigation.snapshot()` and calls `navigation.restore()`. Record the rAF deltas and `lastRenderMs` for every drawn frame. Restore the original snapshot at the end.
  - **Sort settle**: the time from the last orbit frame until `sortState()` reports a new `lastSortTime` with `sorting === false`. Null after 30 s.
  - **Memory**: sample `performance.memory?.usedJSHeapSize` every 250 ms for the whole run and keep the peak. Also record `host.stats().gpuMemoryBytes`. Use `performance.measureUserAgentSpecificMemory()` only when `crossOriginIsolated` is true (it is not on GitHub Pages). Spark's WASM memory is not exposed, so `wasm` is `null` with the reason "not exposed by Spark".
  - **Repeated-load recovery**: reload the same source three times through `load(lastSource)` (or `loadDemoSlab(n)` for the slab). For each, record `firstDraw` and `ready` times, `ok`, and the heap 2 s after Ready. Report `heapGrowth` from the first reload to the last.
  - Header: build, UA, platform, `deviceMemory`, cores, DPR, viewport, renderer, software flag, preset, and the scene name, kind, size, counts, and SH (the same fields as `collectDiagnostics`).
  - It stops early, with a partial report, when the signal aborts or `document.visibilityState` becomes `hidden` (rAF is throttled then).
- `index.html`: `<dialog id="bench-dialog" class="dialog dialog-wide">` with `#bench-status` ("Orbiting… 3 s"), `<pre id="bench-report" class="kv-mono">`, `#bench-copy-md`, `#bench-copy-json`, `#bench-cancel`, and Close. Copy uses the clipboard fallback from `problem.ts` (select the text and show "Press Ctrl+C to copy").
- `BENCHMARK.md`: a new section, **Built-in benchmark**, explaining how to run it on a real device, that SwiftShader numbers from CI are not representative, and an owner table (device, browser, scene, first frame, Ready, frame p50/p90/p99, settle, heap peak, reload growth).
   320|
**Acceptance**

- `?sample=torus-ply&bench=1` shows the dialog with a complete report within 40 s in headless SwiftShader. Copy JSON gives text that parses, with `schema: 'omniview-bench/1'`, numeric percentiles, and three `ok` reloads.
- After the run, the camera position and pivot match the values from before it, within 1e-6. No `pageerror`.
- Without `?bench=1`, no bench chunk is requested.

**Tests**

- Unit `tests/benchStats.test.ts`: percentiles on known arrays, an empty array gives nulls, `over33` counts, and the markdown has a row for every field.
- E2E new `tests-e2e/bench.spec.ts` with clipboard permissions. It runs in its own browser, like the slab badge test, because a long SwiftShader run can wedge the shared one.

**Risks**

- `performance.memory` is Chrome-only and coarse. The report names its source and leaves the field null elsewhere.
- Orbiting through `restore()` skips input handling and inertia, so the frame times measure render and sort only. The report says so.
- Three reloads of a multi-gigabyte local file take minutes. The status line shows progress and Cancel stops between steps.

---

## Summary
   340|
| Batch | Delivers | Main files |
| --- | --- | --- |
| A | Cancel stops fetches, loaders, and parses for every format and disposes late scenes; multi-file and folder opens for glTF and OBJ with real MTL materials and a list of missing files | new `core/abortable.ts`, `core/fileSet.ts`, `renderables/disposeObject.ts`, `ui/dropEntries.ts`; `meshLoader.ts`, `meshRenderable.ts`, `gaussianLoader.ts`, `pointCloudLoader.ts`, `parsePly.ts`, `sniff.ts`, `types.ts`, `loadFailure.ts`, `problem.ts`, `ViewerApp.ts`, `index.html` |
| B | Ready instead of Full quality, a Reduced detail badge with retained and source counts and the active SH; a persistent graphics banner; scene controls disabled before a scene and hidden when they do not apply | new `ui/sceneDetail.ts`, `ui/applicability.ts`; `types.ts`, `decodeGaussianPly.ts`, `gaussianLoader.ts`, `gaussianRenderable.ts`, `pointCloudRenderable.ts`, `ViewerApp.ts`, `index.html`, `styles.css` |
| C | Plain preset text with Details and the consequence for this scene; sample cards with thumbnails; the desktop version on Download; a copyable benchmark report | new `ui/presetConsequence.ts`, `ui/releaseVersion.ts`, `bench/benchStats.ts`, `bench/runBench.ts`, `scripts/render-thumbs.mjs`, `public/samples/thumbs/*.webp`; `qualityPreset.ts`, `samples.ts`, `SceneHost.ts`, `ViewerApp.ts`, `vite.config.ts`, `index.html`, `styles.css`, `BENCHMARK.md` |
