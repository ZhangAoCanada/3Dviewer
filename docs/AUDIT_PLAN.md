# Audit plan: bug fixes, performance, and memory

## Status

Batches 1–5 are ticked off except **2.2**, which was not landed. These still need a real device or the owner's data:

- **2.2** — Measure `lodCount / count` on the torus sample, `?demo=slab&n=1500000`, and one real drone PLY, then replace the `* 2` LoD check. This repo has no drone PLY, so the SH-vs-LoD policy is unchanged.
- **1.2** — Reload the 3.5 GB PLY in Chrome and confirm Task Manager peak stays near one scene.
- **1.3** — Abort a large `.spz` and confirm `renderer.info.memory.textures` returns to the torus-only count.
- **2.3** — Toggle Flip Y on a 14M scene and confirm no long task over 100 ms.
- **2.4** — Load a 1 GB PLY with `?url=` from a range-capable host and confirm memory stays near the decoded size.
- **2.6** — Confirm the stats panel drops by about 72 MB at 8M points.
- **3.2** — On a paged `.rad`, confirm detail sharpens after the pointer is released and the HUD then goes idle.
- **3.7** — On a mid-range Android or iPhone, record orbit and idle fps for `?demo=slab&n=1500000` and one real drone `.rad` or PLY. The mobile Spark settings were left as specified; revert them if orbit fps does not rise by at least 10%.
- **4.2** — During a 2 s trackpad zoom on the 14M scene, `pick` self-time stays under 5% of the frame budget.
- **4.4** — On macOS, hold W, press Cmd+Tab away and back; the camera must not move.
- **4.6** — On a phone, a double-tap focuses. Desktop double-click is unchanged.

Audited at `main` = `b09cbe1` (includes #5 accurate pick + idle frames and #6 stable pivot / near-nadir orbit).
Spark resolved by the lockfile: `@sparkjsdev/spark` **2.2.0** (package.json says `^2.1.0`). Three r180.

Baseline (run once): `npm run typecheck`, `npm run lint`, `npm test` (9 files, 40 tests), `npm run build` all pass.
Build emits one 3.18 MB JS chunk (1.06 MB gzip). PWA precache: 26 entries, 4.15 MB.

## How to use this plan

- Batches are ordered. Inside a batch, tasks are ordered by priority. Each task is one PR unless it says otherwise.
- Severity: **P0** = crash/OOM or data loss on the primary use case (1 GB+ drone PLY), **P1** = wrong result, leak, or large perf loss that users will hit, **P2** = smaller perf/robustness/hygiene.
- Evidence is `file:line` at `b09cbe1`. Re-grep the quoted symbol if lines have moved.
- Every task that touches the frame loop must keep the idle-frame contract: anything that changes what is on screen must set `SceneHost.viewDirty = true` (see `SceneHost.needsDraw`, `src/render/SceneHost.ts:363`).
- Spark internals referenced below (`dirty`, `sortDirty`, `pager`, `lodSplats`) are from `node_modules/@sparkjsdev/spark/dist/spark.module.js` 2.2.0. Task 1.1 pins that version so they stay valid.

---

## Batch 1 — Guardrails, memory lifecycle, and leaks

### [x] 1.1 Pin Spark and lock the packed-splat bit layout with a parity test — P1

- **Evidence**: `package.json:23` `"@sparkjsdev/spark": "^2.1.0"`; lockfile resolves 2.2.0. `src/loaders/gaussian/packSplat.ts:1-5` re-implements Spark's `setPackedSplat` / `encodeSh*` / `encodeExtSplat` bit layout by hand. `SceneHost.needsDraw` reads `spark.dirty` / `spark.sortDirty` (`SceneHost.ts:364`), which are undocumented fields.
- **Root cause**: a caret range lets a fresh `npm install` pick up a Spark minor release that changes the encoding or those fields. The worker decoder would then write corrupt splats with no error.
- **Fix**:
  1. In `package.json`, set `"@sparkjsdev/spark": "2.2.0"` (exact). Run `npm install` so the lockfile records the exact version.
  2. Add `tests/packParity.test.ts`. For 200 seeded random splats (positions from -500 to 500, scales from 1e-4 to 50, random unit quaternions, opacity, rgb, SH bands), encode with `writePackedSplat` / `writePackedSh1/2/3` / `writeExtSplat` / `writeExtSh*`. Encode the same splats with Spark (`new PackedSplats({ maxSplats })` then `setSplat(...)`, with the same `splatEncoding`). Assert the `Uint32Array` words are equal.
  3. If importing Spark fails under the node test environment, add `// @vitest-environment happy-dom` to that file only (dev dependency `happy-dom`). If that also fails, generate golden vectors once in the browser (`?demo=slab` page console), commit them as `tests/fixtures/packGolden.json`, and compare against those.
- **Verify**: the new test passes. Temporarily flip one bit shift in `writePackedSplat` and confirm the test fails.
- **Risk**: low. Future Spark upgrades become deliberate. Re-run the parity test on every upgrade.

### [x] 1.2 Free the previous scene before decoding a large one — P0

- **Evidence**: `src/app/ViewerApp.ts:331` awaits `loader.load(...)` while the old scene is still resident; `this.host.clear()` runs only afterwards (`ViewerApp.ts:344`). `detectMemoryBudget()` (`ViewerApp.ts:333`) does not subtract what is already loaded.
- **Root cause**: opening a second multi-GB scene keeps the old CPU arrays (packedArray, SH, LoD copy, SplatIndex) and GPU textures alive while the new decode allocates its full budget. Peak memory is roughly 2× the budget, so the tab gets OOM-killed ("Aw, Snap" / iOS reload).
- **Fix** in `ViewerApp.load`:
  1. After `registry.resolve` and before `loader.load`, compute `const large = (source.sizeBytes ?? Infinity) >= 64 * 1024 * 1024 || this.host.items.some((i) => (i.getStats().memoryBytes ?? 0) >= 256 * 1024 * 1024);`. Unknown size counts as large.
  2. If `large`, call `this.host.clear()`, then `this.renderSceneInfo()`. Keep the loading overlay visible; do not call `setEmpty(true)` until the load fails.
  3. Leave the current behavior (keep the old scene until the new one is ready) for small files, so sample switching does not flash.
  4. In the `catch` block the existing `this.setEmpty(this.host.items.length === 0)` already handles the empty state.
- **Verify**: manual. In Chrome, load the 3.5 GB PLY, then load it again. Watch Task Manager memory: the peak must stay near one scene's footprint instead of two. Add a unit test only if `ViewerApp` gets a seam; otherwise this is a manual check recorded in `BENCHMARK.md`.
- **Risk**: low. The old scene disappears during a large load, which is the desired trade-off.

### [x] 1.3 Abort and dispose correctly in the Spark fallback path — P1

- **Evidence**: `src/loaders/gaussian/gaussianLoader.ts:315-322`. `new SplatMesh(options)` is awaited, then `throwIfAborted` throws **without** `mesh.dispose()`. `ctx.signal` is never passed to Spark, and `options.stream = source.file.stream()` (`:301`) keeps reading after abort.
- **Root cause**: when a newer load supersedes a `.spz/.sog/.rad/.splat/.ksplat` (or compressed PLY) load, the old Spark decode runs to completion and its textures leak.
- **Fix** in `loadViaSpark`:
  1. For the stream case, Spark locks the stream it is given, so it cannot be cancelled from outside. Pipe through a `TransformStream` whose writable side follows the abort signal: `const ts = new TransformStream<Uint8Array, Uint8Array>(); source.file.stream().pipeTo(ts.writable, { signal: ctx.signal }).catch(() => {}); options.stream = ts.readable;`. Aborting errors the readable side, which ends Spark's read loop.
  2. Register `const onAbort = () => mesh.dispose();` on `ctx.signal` right after constructing the mesh, and remove it in `finally`.
  3. Replace the bare `throwIfAborted(ctx.signal)` after `await mesh.initialized` with: `if (ctx.signal.aborted) { mesh.dispose(); throwIfAborted(ctx.signal); }`.
  4. In `meshFromDecoded` (`gaussianLoader.ts:121-198`), wrap everything after `new SplatMesh` in `try/catch`: on error, `mesh.dispose()` and rethrow. Also check `throwIfAborted` after `await mesh.initialized` and after `createLodSplats`, disposing first.
- **Verify**: manual. Open a large `.spz` and immediately open the torus sample. `renderer.info.memory.textures` (log it from the console via `window.__host` if you expose it in dev only) returns to the torus-only value. Unit test: mock a `SplatMesh`-like object whose `initialized` resolves after abort and assert `dispose` was called (extract the abort/dispose logic into a small helper `disposeIfAborted(mesh, signal)` to make it testable).
- **Risk**: low. Do not dispose a mesh that was returned successfully.

### [x] 1.4 Point-cloud worker: wire abort, remove the fixed 120 s kill, and stop the main-thread fallback for big files — P1

- **Evidence**: `src/loaders/points/pointCloudLoader.ts:21-24` hard timeout of 120 s regardless of size; `:16-42` no `ctx.signal` listener; `:62-66` any worker failure (including that timeout) falls back to `parsePlyPoints` on the **main thread**.
- **Root cause**: a multi-GB point cloud on a slow disk is killed at 120 s, then re-parsed on the UI thread, which freezes the tab. An aborted load keeps a worker reading the whole file.
- **Fix**:
  1. Change `parseInWorker(file, maxPoints)` to `parseInWorker(file, maxPoints, signal, onProgress)`. Mirror `decodeInWorker` in `gaussianLoader.ts:51-103`: a `settled` guard, `signal` abort listener → `worker.terminate()` + reject `AbortError`, and `worker.onmessageerror` → reject.
  2. Delete the 120 s `setTimeout`; the app-level watchdog (task 1.5) owns timeouts.
  3. Make `parsePlyPoints` accept an optional `onProgress(loadedVerts, totalVerts)` (call every ~150 ms like `decodeGaussianPly.report`) and post `{ type: 'progress' }` messages from `src/workers/plyPoints.worker.ts`. Change the response shape to `{ type: 'progress' | 'result' | 'error' }` like the gaussian worker.
  4. In `load`, fall back to the main thread only when `blob.size <= 64 MiB` and the signal is not aborted; otherwise rethrow.
- **Verify**: extend `tests/parsePly.test.ts` to assert `onProgress` is called with a monotonically increasing count ending at `vertex.count`. Manual: abort a large point-cloud load and confirm in DevTools > Sources > Threads that the worker disappears.
- **Risk**: low.

### [x] 1.5 Replace the fixed load timeout with a stall watchdog — P1

- **Evidence**: `ViewerApp.ts:310` `loadTimeoutMs(source.sizeBytes)` and `ViewerApp.ts:497-502`. For URL loads `sizeBytes` is undefined, so a 1 GB+ `?url=` load is aborted after **3 minutes**, including download time. A large local file that decodes slowly but steadily is still cut at 45 min.
- **Root cause**: the timeout is a wall-clock budget picked from a size that is often unknown, rather than a measure of whether the load is still making progress.
- **Fix** in `ViewerApp.load`:
  1. Replace the single `setTimeout` with a stall timer: `const STALL_MS = 90_000; let stall = 0; const arm = () => { clearTimeout(stall); stall = window.setTimeout(() => abort.abort(new Error('Loading stalled: no progress for 90 s. ...')), STALL_MS); }; arm();`.
  2. Call `arm()` at the top of the `onProgress` callback, before the generation check.
  3. Clear it in `finally`. Delete `loadTimeoutMs`.
  4. Make sure every long phase emits progress. The gaussian worker already reports every 150 ms. Add a progress tick before `await mesh.initialized` and before `createLodSplats` in `meshFromDecoded`. `createLodSplats` on 14M splats can take more than 90 s on a slow machine, so set a phase-specific stall of 10 min while `stage === 'gpu'`: pass the stage to `arm(stage)` and pick `STALL_MS` from it.
- **Verify**: add a unit-testable helper `createStallWatchdog(ms, onStall)` in `src/core/watchdog.ts` with fake timers in vitest: `kick()` postpones; no kick → fires once.
- **Risk**: low. Error text should still mention converting to `.rad`.

### [x] 1.6 Mesh loader: dispose textures, and keep authored normals — P1

- **Evidence**: `src/renderables/meshRenderable.ts:131-138` disposes materials and geometry but never textures (`material.dispose()` does not free `map`, `normalMap`, …). `meshRenderable.ts:52` calls `computeVertexNormals()` on **every** mesh.
- **Root cause**: reloading a textured glb leaks every GPU texture. Recomputing normals overwrites glTF-authored normals: hard edges and UV seams become smoothed or wrong, and it costs O(vertices) per mesh at load.
- **Fix**:
  1. Line 52: `if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();`.
  2. In `dispose()`, collect textures before disposing materials: for each material in `slot.original`, iterate `Object.values(material)` and dispose values with `isTexture === true` into a `Set<THREE.Texture>` (dedupe shared maps), then dispose them.
  3. In `applySettings` (`:67-102`), return early when `shading` and `wireframe` are unchanged since the last call. Store `lastShading` / `lastWireframe` fields. Today every splat-scale slider tick clones every material.
- **Verify**: load `crate.glb`, then the torus sample, 10 times; `renderer.info.memory.textures` must not grow. Unit test for (1) with a `BufferGeometry` that has a custom `normal` attribute: assert it is unchanged after constructing `MeshRenderable`.
- **Risk**: low. OBJ files without normals still get computed normals.

### [x] 1.7 Handle WebGL context loss — P1

- **Evidence**: `src/render/SceneHost.ts:56-61` creates the context; there is no `webglcontextlost` / `webglcontextrestored` handling anywhere in `src/`.
- **Root cause**: on mobile (backgrounding, GPU memory pressure from a big scene) and on desktop driver resets, the canvas goes black permanently with no message. Spark does not rebuild its textures.
- **Fix**:
  1. In the `SceneHost` constructor: `canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; this.onContextLost?.(); })` and `webglcontextrestored` → `this.contextLost = false; this.onContextRestored?.()`.
  2. In the animation loop, skip all work while `contextLost`.
  3. In `ViewerApp`, keep `this.lastSource: AssetSource | null` (set in `load` on success). `onContextLost` → toast "The GPU reset. Reloading the scene…" (warn). `onContextRestored` → `this.host.clear()` then `void this.load(this.lastSource)` if set.
- **Verify**: in the console, `const ext = renderer.getContext().getExtension('WEBGL_lose_context'); ext.loseContext(); setTimeout(() => ext.restoreContext(), 1000);`. The toast appears and the scene reloads.
- **Risk**: medium. Re-decoding a 3.5 GB file after a context loss takes minutes; the toast must say so. Do not auto-reload when `lastSource.origin === 'url'` and size is unknown; ask via toast instead.

### [x] 1.8 Worker plumbing hardening — P2

- **Evidence**: `gaussianLoader.ts:81-100` has no `onmessageerror`. `gaussianLoader.ts:158,171` construct `SplatMesh` with `raycastable: count <= 1_000_000`, then `GaussianRenderable` forces `raycastable = false` (`gaussianRenderable.ts:36`). `gaussianLoader.ts:205-216` re-runs the full decode on the main thread after any worker error for files up to 64 MB, even when the worker error was a deterministic `GaussianPlyError`.
- **Fix**:
  1. Add `worker.onmessageerror = () => finish(new Error('Gaussian decode result could not be transferred'))`.
  2. Pass `raycastable: false` at construction in both places.
  3. In `gaussianPly.worker.ts`, post `{ type: 'error', message, name: error.name }`. In `decodeInWorker`, reject with an `Error` whose `name` is copied. In `loadStandardPly`, only fall back to the main thread when `name` is not `GaussianPlyError` / `GaussianPlyUnsupported`.
- **Verify**: unit test for the name round-trip by calling the worker's message handler logic directly (extract it into `handleDecodeRequest(data, post)`).
- **Risk**: low.

---

## Batch 2 — Huge-PLY decode: planner, peaks, and load time

### [x] 2.1 Planner picks encoding and SH before applying the resident-count cap — P1

- **Evidence**: `src/loaders/gaussian/gaussianPlan.ts:73-94` chooses `shDegree` / `extended` for the **full** `sourceCount`. If that does not fit, it forces `shDegree = 0, extended = false`. The mobile cap (`:96-107`) is applied afterwards and never revisits the choice.
- **Root cause**: on a phone (budget 192 MB → 119 MB usable), a 14M SH3 PLY is subsampled to 700k splats, but stays at SH0 with half-float centers. At 700k, extended + SH1 needs only about 34 MB. Desktop has the same flaw whenever `fullFit` fails: it drops straight to SH0 packed.
- **Fix** (rewrite `planGaussianDecode`, keep its signature):
  1. `targetCount = sourceCount`; on mobile, `targetCount = min(sourceCount, budget.maxSplatsResident)`.
  2. Run the existing `(encodings × sh from shCap down to 0)` loop against `estimateDecodedBytes(targetCount, …)`. The first fit wins.
  3. If nothing fits at `targetCount`, use `fitCount(sourceCount, 0, false, usable)` as today.
  4. `stride = max(1, ceil(sourceCount / decodedCountChosen))`, `decodedCount = ceil(sourceCount / stride)`. Re-check the bytes and bump the stride while it is over budget, as the current loop at `:100-106` does.
  5. Keep the notes logic. Notes must reflect the final choice.
- **Verify**: add cases to `tests/gaussianPly.test.ts`. Mobile budget (`detectMemoryBudget({ userAgent: 'iPhone', deviceMemory: 4 })`) with 14M SH3 and `preferExtended: true` must give `decodedCount <= 700_000`, `extended === true`, `shDegree >= 1`. The existing desktop expectations must still hold.
- **Risk**: low. Memory stays within `usable`; only quality improves.

### 2.2 Budget the real LoD cost, and prefer LoD over SH for very large scenes — P1

Skipped in batch 2. Step 1 needs `lodCount / count` from the torus sample, `?demo=slab&n=1500000`, and one real drone PLY before the `* 2` factor or the SH-vs-LoD policy can change. This repo has no drone PLY (`tmp/` is gitignored; `BENCHMARK.md` records that the 14,161,020-splat file was not generated). A torus or synthetic slab ratio is not that tree, so steps 2–4 were not landed. The existing `estimatedBytes * 2` check is unchanged.

- **Evidence**: `gaussianPlan.ts:17-19,110-111` assume "LoD builds a second copy" (`estimatedBytes * 2 <= cpuBytes * 0.85`). Spark 2.2.0 `PackedSplats.createLodSplats` (`spark.module.js:9564-9596`) does `this.packedArray.slice()` and slices every SH array on the main thread, sends them to a worker, and keeps the original (`nonLod = true`) **plus** the new `lodSplats`, which hold the interior tree nodes too. The real peak is roughly base + full copy + LoD output, and the LoD output is larger than the base.
  At the same time, for the flagship 14M SH3 desktop case the plan picks extended SH2 (about 940 MB), so `lod === false` and Spark sorts and draws all 14M every frame (`gaussianPlan.ts:127-129` note).
- **Root cause**: the LoD factor is a guess, and the policy spends memory on SH bands instead of on LoD, which is what makes 14M splats real-time.
- **Fix**:
  1. **Measure first.** In `meshFromDecoded` after `createLodSplats`, read `mesh.packedSplats?.lodSplats?.numSplats` (or `mesh.extSplats?.lodSplats`) and record `lodCount` in `GaussianSceneInfo`; show it in the scene info panel. Load the torus sample, the `?demo=slab&n=1500000` demo, and one real drone PLY, then record `lodCount / count` in `BENCHMARK.md`.
  2. Replace the `* 2` with `LOD_PEAK_FACTOR = 1 /*base*/ + 1 /*slice copy*/ + measuredRatio /*lod output*/` (start with `3.2` until measured) and compare against `cpuBytes * LOD_HEADROOM`.
  3. New policy in `planGaussianDecode`: when `decodedCount > 2 * budget.maxSplatsResident`, try to make LoD fit **before** keeping higher SH. Iterate SH from `shCap` down to 0, then extended→packed, and stop at the first combination where `estimate * LOD_PEAK_FACTOR <= cpuBytes * LOD_HEADROOM`. Keep the current behavior (no LoD) only if even packed SH0 cannot fit LoD. Emit a note: "Spherical harmonics reduced to N so a level-of-detail tree fits."
  4. Add `lodCount` to `GaussianSceneInfo` and `getStats().extra.lod`.
- **Verify**: planner unit tests for 14M SH3 on desktop 8 GB: `lod === true`. Manual: on the 3.5 GB scene, record fps while orbiting (HUD) and peak memory in Chrome Task Manager, before and after, in `BENCHMARK.md`.
- **Risk**: medium. This trades view-dependent colour for frame rate. Keep the `#extended` / SH UI so users can force quality. Do not land step 3 without the step 1 measurement.

### [x] 2.3 Compute bounds during decode instead of walking every splat on the main thread — P1

- **Evidence**: `src/renderables/gaussianRenderable.ts:92-101` calls `SplatMesh.getBoundingBox(true)`, which in Spark 2.2.0 (`spark.module.js:12386-12425`) runs `forEachSplat` and fully decodes every splat in JS. `SceneHost.frameAll` (`SceneHost.ts:181-200`) calls `getBounds` on every load, every Flip-Y toggle, and every up-axis change. For 14M splats that is a multi-second main-thread hitch each time. Drone 3DGS also has far floaters, which make the full box huge: framing zooms out too far, `detectUpAxis` misreads the shape, and the `SplatIndex` cell (`longest / 160`, `splatIndex.ts:5,223-224`) gets coarse.
- **Fix**:
  1. In `decodeGaussianPly` (`consumeFloats` / `consumeView`), track min/max of kept centers (6 numbers). Also reservoir-sample up to 65,536 kept centers into a `Float32Array(65536 * 3)`.
  2. After the loop, compute per-axis 0.5th / 99.5th percentiles from the sample (sort each axis copy).
  3. Return `bounds: { min, max }` and `robustBounds: { min, max }` on `DecodedGaussian`, and pass both through `GaussianSceneInfo`.
  4. In `GaussianRenderable.getBounds`: if `sceneInfo.robustBounds` exists, return it in local space `.applyMatrix4(matrixWorld)`. Otherwise compute `getBoundingBox(true)` **once**, cache the local box in a private field, and reuse it.
  5. Use the robust box for framing and `SplatIndex` bounds. Points outside it are already clamped into edge cells by `clampIndex`.
- **Verify**: unit test in `tests/gaussianPly.test.ts`: a synthetic PLY with 10,000 splats in [0, 1]³ plus 10 floaters at 1e4. `robustBounds.max.x < 2`, and `bounds.max.x ≈ 1e4`. Manual: toggle Flip Y on a 14M scene; Performance panel shows no long task over 100 ms.
- **Risk**: low. Framing changes slightly for scenes with legitimate sparse extremities; 99.5% is conservative.

### [x] 2.4 Stream URL-hosted PLYs with Range requests instead of `res.blob()` — P1

- **Evidence**: `gaussianLoader.ts:41-49` `blobOf` → `res.blob()` downloads the whole file before decoding, with no download progress (the overlay sits on "Downloading …"). Safari keeps large blobs in memory, so a 1 GB+ `?url=` load is an OOM on iOS. `pointCloudLoader.ts:6-14` has the same pattern.
- **Root cause**: the decoder only needs sequential slices (`blob.slice(a, b).arrayBuffer()` in `decodeGaussianPly.ts:194-195,312`), but URL sources are materialised in full first.
- **Fix**:
  1. Add `src/core/byteSource.ts` exporting `interface ByteSource { size: number; read(start: number, end: number): Promise<ArrayBuffer> }`, `blobSource(blob)`, and `rangeSource(url, size, signal)`. `rangeSource.read` does `fetch(url, { headers: { Range: \`bytes=${start}-${end - 1}\` }, signal })`, requires status 206, and returns `arrayBuffer()`.
  2. Change `readGaussianPlyHeader`, `decodeGaussianPly`, and `parsePlyPoints` to take a `ByteSource` instead of a `Blob` (blob callers wrap with `blobSource`).
  3. In the worker request, send either `{ blob }` or `{ url, size }` and build the source inside the worker, so bytes never touch the main thread.
  4. In `gaussianLoader.load` for URL + `.ply`: `contentLength` already does a HEAD (`:24-32`). Also read `accept-ranges`. If `size` is known and `accept-ranges: bytes` is present (GitHub Pages, S3, and R2 all send it), use the range path. Otherwise keep the `res.blob()` path.
  5. Add a one-chunk read-ahead in the decode loop (start `read(next)` before decoding the current chunk) so network and decode overlap; this also helps local files (see 2.5).
  6. Report download progress as decode progress (bytes are consumed exactly once).
- **Verify**: unit test with a fake `ByteSource` that records calls: reads are sequential, non-overlapping, and cover `[header.byteLength, end)`. Manual: `?url=` pointing at a 1 GB PLY on a range-capable host; memory stays near the decoded size and the progress bar moves during the download.
- **Risk**: medium. CORS: `Range` is a CORS-safelisted header for single ranges, but servers must expose `Content-Range`/`Accept-Ranges`. Keep the blob fallback.

### [x] 2.5 Decoder hot loop: no per-splat allocation, overlapped reads, non-finite guard — P2

- **Evidence**: `decodeGaussianPly.ts:504-535` `readFloats` allocates a `Sample` object per splat (14M short-lived objects) and `writeSample` takes it by reference. `:451` allocates a `read` closure per vertex in `consumeView`. `:312` awaits each 8 MB slice serially, with no read-ahead. NaN/Inf centers (they do occur in trained scenes) are written as-is and poison Spark's bounds and the camera framing.
- **Fix**:
  1. Make `writeSample` take scalars, or a single module-level reusable `Sample` object that `readFloats` fills, instead of returning a new literal.
  2. In `consumeView`, hoist the type lookups out of the loop (`const tx = layout.types.x ?? 'float'`, …) and call `readScalar(view, at + layout.x, tx, little)` directly.
  3. Read-ahead: `let pending = source.read(filePos, filePos + take);` then in the loop `const buf = await pending; pending = next ? source.read(...) : null;`, then decode `buf`.
  4. In `consumeFloats` / `consumeView`, `continue` (without incrementing `kept`) when `!Number.isFinite(x + y + z)`. Arrays are already sized for the planned count, so a smaller `kept` is safe. Add `skippedNonFinite` to the notes when it is > 0.
- **Verify**: add a micro-benchmark under `tests/bench/decode.bench.ts` (vitest `bench`, not run in CI) over a synthetic 500k-splat SH3 PLY. Record before/after decode ms in `BENCHMARK.md`. Unit test: a PLY with one NaN splat decodes `count === n - 1`.
- **Risk**: low.

### [x] 2.6 Point clouds: double-precision recentering, compact colors, up-aware colorize — P1 (precision) / P2 (memory)

- **Evidence**: `src/loaders/points/parsePly.ts:72-73,252-254` writes `double` x/y/z straight into `Float32Array`. UTM-scale coordinates (for example 4,500,000 m) quantize to 0.25–0.5 m, so drone point clouds jitter and look blocky. Colors are `Float32Array(samples * 3)` (`:73`): 96 MB at the 8M desktop cap where `Uint8` would be 24 MB. `colorizeByHeight` (`:326-343`) always uses Y, which stripes Z-up drone clouds. The ASCII tail (`:317-323`) drops colors for the last line.
- **Fix**:
  1. In `readBinary` / `readAscii`, take the first finite vertex as `origin` (JS doubles) and store `x - origin.x` etc. Return `origin: [number, number, number]` on `PointCloudData`.
  2. In `PointCloudRenderable`, set `this.object.position.set(...origin)`. Three computes `modelViewMatrix` in float64 on the CPU, so precision is preserved relative to the camera.
  3. `SplatIndex` must read the matrix as `Float64Array` (see 4.5 step 3) or it loses the origin again.
  4. Store colors as `Uint8Array` and use `new THREE.BufferAttribute(colors, 3, true)` (normalized). Float source colors are converted with `Math.round(clamp01(v) * 255)`.
  5. `colorizeByHeight(positions, upAxis)`: choose the axis from `detectUpAxis` on the positions' bounding box; output `Uint8Array`.
  6. Fix the ASCII tail to also write colors.
- **Verify**: `tests/parsePly.test.ts`: a binary PLY with `double` x = 4,500,000.123 and 4,500,000.623 must decode to positions whose difference is 0.5 ± 1e-3. Colors are a `Uint8Array`. Stats panel memory drops by about 72 MB at 8M points.
- **Risk**: low. `getBounds` uses `setFromObject`, which includes `position`, so framing is unaffected.

### [x] 2.7 Gaussian recentering and SH quantization range — P2

- **Evidence**: half-float centers (`packSplat.ts:183-184` `toHalf(x)`) overflow to ±Infinity above 65504 and have 0.25–1 m spacing between 512 and 2048. A packed-mode PLY in projected coordinates therefore vanishes, and a large local survey looks blocky. `DEFAULT_LIMITS.sh1Max/sh2Max/sh3Max = 4` (`packSplat.ts:22-30`) gives a 7-bit SH1 step of 4/63 ≈ 0.063, while Spark's own default is 1 (`spark.module.js:33-40`). Typical SH1 coefficients are smaller than that step, so view-dependent colour is mostly zeroed in packed mode.
- **Fix**:
  1. Origin: in `decodeGaussianPly`, before the main loop, read the first chunk and take the mean of its centers (or the georef `min/max` midpoint when present) as `origin`. Subtract it in `writeSample`, return it, and set `mesh.position` in `meshFromDecoded`. Update the 2.3 bounds to local space accordingly.
  2. SH range: sample |coef| over the first chunk per band, set `shNMax = clamp(percentile99, 0.25, 4)`, and pass it through `limits` (already plumbed to Spark via `splatEncoding`, `gaussianLoader.ts:129-137`).
- **Verify**: unit test: a packed decode of splats at x = 70,000 yields finite centers after `toHalf` (decode with `halfToFloat` + origin). Encode/decode an SH1 coefficient of 0.03; the error must be below 0.01 with derived limits (it is 0.03 today).
- **Risk**: medium. The origin shifts `SplatIndex`, coarse-surface, and georef display; all already go through `matrixWorld`. Run task 1.1's parity test after changing limits.

---

## Batch 3 — Rendering and the frame loop

### [x] 3.1 The LoD slider is applied two or three times — P1

- **Evidence**: `SceneHost.ts:152-153` sets `spark.lodSplatScale = s` **and** `spark.lodSplatCount = maxSplatsResident * s`. Spark computes `maxSplats = lodSplatCount * lodSplatScale` (`spark.module.js:14057-14059`), so the effective budget is `maxSplatsResident × s²`. `gaussianRenderable.ts:42` also sets per-mesh `lodScale = s`, a third factor in the LoD traversal (`spark.module.js:14254`).
- **Root cause**: the slider at 2.0 asks for 4× the resident budget (plus the per-mesh factor), which overloads mobile GPUs. At 0.35 it asks for 0.12×.
- **Fix**: in `SceneHost.applySettings`, keep `spark.lodSplatCount = this.budget.maxSplatsResident` (constant) and set only `spark.lodSplatScale = settings.lodSplatScale`. In `GaussianRenderable.applySettings`, delete the `lodScale` assignment so it stays 1.
- **Verify**: unit-test `SceneHost.applySettings` is hard (WebGL). Instead, extract `lodParams(budget, settings) → { lodSplatCount, lodSplatScale }` into `src/render/lodParams.ts` and test that the product equals `maxSplatsResident * s`. Manual: HUD "Active splats" at slider 2.0 is about 2× the value at 1.0, not 4×.
- **Risk**: low. Users who tuned the slider will see less detail at values above 1.

### [x] 3.2 Idle skipping stalls paged `.rad` refinement — P1

- **Evidence**: `SceneHost.needsDraw` (`SceneHost.ts:363-367`) only redraws for camera motion or `spark.dirty/sortDirty`. In Spark 2.2.0 the pager advances only inside a rendered frame: `driveLod` consumes `pager.consumeLodTreeUpdates()` (`spark.module.js:14157`), `processUploads()` (`:14281`), and `driveFetchers()` (`:14313`). Fetched pages sit in `pager.fetched/newUploads` (`:11515-11520`, `:12017-12022`) without calling `setDirty`.
- **Root cause**: after the camera stops, network chunks keep arriving but are never uploaded or traversed, so a `.rad` scene stays blurry until the user moves.
- **Fix**: add to `needsDraw`:
  ```ts
  const pager = (this.spark as unknown as { pager?: { fetchers: unknown[]; fetched: unknown[]; newUploads: unknown[]; readyUploads: unknown[]; lodTreeUpdates: unknown[] } }).pager;
  if (pager && (pager.fetchers.length || pager.fetched.length || pager.newUploads.length || pager.readyUploads.length || pager.lodTreeUpdates.length)) return true;
  ```
  Also add a settle window: keep drawing for 1.0 s after the last motion (`this.lastMotionTime`), so async LoD traversal results that land between frames are not missed.
- **Verify**: manual with a paged `.rad`. Move, release, and wait: detail keeps sharpening without input, and the HUD fps settles to about 0 (idle) once loading finishes. Pinning Spark (task 1.1) keeps these field names valid.
- **Risk**: low. The field names are Spark internals, so guard every access with optional chaining.

### [x] 3.3 Slider input reallocates the drawing buffer on every tick — P1

- **Evidence**: `SceneHost.applySettings` (`:148-157`) always calls `applyPixelRatio` → `renderer.setPixelRatio` → `setSize`, which writes `canvas.width/height` and clears and reallocates the default framebuffer even when the value is unchanged. It also changes Spark's `renderSize`, which marks LoD dirty. This fires on every `input` event of the splat-scale, point-size, and LoD sliders (`ViewerApp.ts:126-140`).
- **Root cause**: per-tick framebuffer reallocation causes stutter and flashes on mobile.
- **Fix**:
  1. In `applyPixelRatio`, compute `dpr`, then `if (dpr === this.renderer.getPixelRatio()) return;` before `setPixelRatio` / `resize()`.
  2. Because `resize()` was the only thing setting `viewDirty` for these settings, add `this.viewDirty = true;` at the end of `applySettings`.
  3. `resize()`: skip `setSize` when width, height, and DPR are unchanged; still set `viewDirty`.
- **Verify**: manual. Performance panel while dragging the splat-scale slider: no `canvas.width` writes or GPU memory spikes. The visual result still updates on every tick, which confirms `viewDirty`.
- **Risk**: low.

### [x] 3.4 Honest FPS and frame-time numbers — P2

- **Evidence**: `SceneHost.ts:319` increments `fpsFrames` on every rAF tick, including skipped frames. Idle shows about 60 fps and `frameMs` is the rAF interval, not render cost, which misleads benchmarking.
- **Fix**: count only frames where `draw` is true; measure `const t0 = performance.now(); renderer.render(...); this.renderMs = ema(performance.now() - t0)`. Add `renderMs` and `idle: boolean` to `FrameStats`; show "idle" in the HUD fps slot when no frame drew in the window. Optional: GPU time via `EXT_disjoint_timer_query_webgl2` when available.
- **Verify**: when idle the HUD shows "idle". While orbiting, fps matches the DevTools frame-rate meter.
- **Risk**: low. Update `BENCHMARK.md` methodology text.

### [x] 3.5 The "Splat scale" slider changes the Gaussian cutoff, not the splat size — P2

- **Evidence**: `SceneHost.ts:149` `spark.maxStdDev = sqrt(8) * splatScale`, with slider range 0.4–2.2 (`index.html:93`). At 2.2 the quad covers 6.2σ: about 4.8× fill rate for an invisible tail. At 0.4 (1.1σ) splats become hard discs.
- **Fix** (no visual redesign): clamp the slider to `min="0.75" max="1.15"` (2.1σ–3.25σ) and relabel it "Splat cutoff". Keep the setting key. If a true size scale is wanted later, implement it as a Spark `objectModifier` dyno on scales (separate task).
- **Verify**: manual fps at max slider, before and after, on the slab demo (`?demo=slab&n=1500000`).
- **Risk**: low.

### [x] 3.6 Clamp the requested SH degree to what was decoded — P2

- **Evidence**: settings start at `budget.maxSh` (3 on desktop, `ViewerApp.ts:33-36`). `GaussianRenderable.applySettings` (`:43-50`) then sets `maxSh = 3` and calls `setMaxSh(3)` + `updateGenerator()` on a mesh decoded with SH0–2, forcing a generator rebuild at load for nothing.
- **Fix**: `const want = Math.min(settings.shDegree, this.sceneInfo?.shDegree ?? 3); if (this.object.maxSh === want) return;` and use `want` below.
- **Verify**: unit-free; check that loading a planner-reduced scene logs no `updateGenerator` call (temporary console count).
- **Risk**: low.

### [x] 3.7 Mobile render budget tuning (measured) — P2

- **Evidence**: `SceneHost.ts:81-90` uses the same Spark options on all profiles. `lodRenderScale` defaults to 1 (1-pixel minimum splat), and `minSortIntervalMs` defaults to 0.
- **Fix**: for `budget.profile === 'mobile'`, set `lodRenderScale: 1.5` and `minSortIntervalMs: 33`. Expose neither in UI.
- **Verify**: on a mid-range Android or iPhone with `?demo=slab&n=1500000` and one real drone `.rad`/PLY, record fps while orbiting and while idle before and after in `BENCHMARK.md`. Revert any setting that does not improve fps by at least 10%.
- **Risk**: low (visual softness at 1.5 is usually invisible).

### [x] 3.8 Resize on container and DPR changes — P2

- **Evidence**: `ViewerApp.ts:46` only listens to `window.resize`. DPR changes (moving between monitors, browser zoom) are not handled, so the canvas stays blurry or oversized.
- **Fix**: in `SceneHost`, a `ResizeObserver` on `canvas.parentElement` → `resize()`, plus `matchMedia(\`(resolution: ${devicePixelRatio}dppx)\`)` `change` → re-run `applyPixelRatio(lastSettings)` and re-arm the query. Remove the window listener.
- **Verify**: drag the window between a 1× and a 2× monitor; `renderer.getPixelRatio()` updates.
- **Risk**: low.

### [x] 3.9 Adaptive near plane for close inspection — P2

- **Evidence**: `Navigation.frame` (`Navigation.ts:109-110`) sets `near = radius / 800` once. For a 1 km scene that is 0.6 m, so zooming onto a detail clips it, and fly mode can go well inside near.
- **Fix**: in `SceneHost` before render, if moving, set `near = clamp(distanceToPivot / 400, radius / 1e5, radius / 800)` and `updateProjectionMatrix()` only when it changes by more than 10%.
- **Verify**: on the slab demo, zoom to `minDistance`; no clipping of the surface under the cursor.
- **Risk**: low to medium (depth precision; splats are sorted, not depth-tested, so the impact is small).

---

## Batch 4 — Interaction and picking

### [x] 4.1 Pan and pinch-pan use the pivot direction instead of the camera axes — P1

- **Evidence**: since #6 the camera is no longer re-aimed at a new pivot (`Navigation.ts:326-331` comment, `orbitCamera`), so the pivot is often off the optical axis. `panInViewPlane` (`src/render/cameraMotion.ts:129-153`) still builds its basis from `_view = pivot - camera` (`:139`) and `right = view × up` (`:146`). It also scales by Euclidean `depth` (`Navigation.ts:355-363` passes `distanceTo(anchor)`), not view-space depth. With a pivot near the screen edge (up to about 35° off-axis at 55° vfov / 16:9), the pan direction is rotated and the grabbed point drifts off the cursor.
- **Fix**:
  1. Change the signature to `panInViewPlane(camera: THREE.Camera, pivot, fovDeg, viewHeightPx, dxPx, dyPx, anchor: THREE.Vector3)`.
  2. Inside: `right = (1,0,0).applyQuaternion(camera.quaternion)`, `up = (0,1,0).applyQuaternion(q)`, `forward = (0,0,-1).applyQuaternion(q)`, `depth = max((anchor - camera.position) · forward, 1e-4)`. Translate camera and pivot by `-dx * wpp * right + dy * wpp * up`.
  3. Update both call sites in `Navigation.ts` (`:355`, `:389`). Keep `worldUp` out of the function, so roll cannot creep in via a cross product.
  4. Re-normalize `camera.quaternion` once per drag end in `endDrag()` to stop drift from repeated `premultiply` (`cameraMotion.ts` `rotateAbout`).
- **Verify**: new test in `tests/navigation.test.ts`. Camera at origin with a quaternion rotated 30° yaw away from the pivot direction, and an anchor projected to pixel (u, v). After `panInViewPlane(..., dx=37, dy=-21, anchor)`, project the anchor again and assert it moved by (37, -21) ± 0.5 px. Run the existing pan test too.
- **Risk**: low. The behavior is identical when the pivot is centered.

### [x] 4.2 Wheel zoom picks on every event — P2

- **Evidence**: `Navigation.ts:429` `query()` on every `wheel` event. `SceneHost.pick` (`:236-275`) allocates a `Vector2`, traverses `content` to collect meshes, and runs `raycaster.intersectObjects` (no BVH: O(triangles) for large glb) plus up to 100k `SplatIndex` tests. Trackpads emit 60–120 wheel events per second, and the anchor can also jitter between events.
- **Fix**:
  1. In `NavigationController`, cache the last wheel hit `{ x, y, time, hit }`. Reuse it when the pointer moved 3 px or less and fewer than 200 ms have passed.
  2. In `SceneHost`, cache the mesh list and rebuild it in `add` / `clear` instead of traversing per pick. Reuse a member `Vector2`.
  3. If a single mesh has more than 500k triangles, skip the exact raycast for wheel picks (use `SplatIndex`, extended to mesh vertex positions via `collectIndexSources` handling `isMesh` the same way as `isPoints`).
- **Verify**: Performance panel during a 2 s trackpad zoom on the 14M scene: total `pick` self-time is under 5% of the frame budget.
- **Risk**: low.

### [x] 4.3 Inertia velocity assumes 60 Hz pointer events — P2

- **Evidence**: `Navigation.ts:349-351` `yawVel = yaw / (1/60)`. On 120/144 Hz displays, pointer events arrive about every 8 ms, so release velocity (and the coast) is about 2× too strong. On a slow frame it is too weak.
- **Fix**: track `lastMoveTime = event.timeStamp`; `dt = clamp((t - lastMoveTime) / 1000, 1/240, 1/20)`; `yawVel = lerp(yawVel, yaw / dt, 0.5)`. In `onPointerUp`, zero the velocity if more than 80 ms have passed since the last move (the user stopped before releasing).
- **Verify**: unit-test a small pure helper `releaseVelocity(samples)` with synthetic 8 ms and 16 ms streams producing equal velocity for equal angular speed.
- **Risk**: low.

### [x] 4.4 Stuck keys and fly-mode touch jumps — P2

- **Evidence**: `Navigation.ts:500-505` adds any `keydown` code. On macOS, keyups are not delivered while Cmd is held (Cmd+W, Cmd+Tab), so a key stays in `keys`: fly mode drifts forever and `isMoving()` keeps the idle loop busy. `moveFlyPointer` (`:452-458`) uses `this.lastY` from the first finger when a second finger lands, so the camera jumps.
- **Fix**: ignore `keydown` when `metaKey || ctrlKey`, and clear `keys` on `keyup` of `MetaLeft/MetaRight`. Add `document.addEventListener('visibilitychange', onBlur)`. When the touch pointer count changes in fly mode, reset `lastY` to the new average before computing a delta.
- **Verify**: manual on macOS: hold W, press Cmd+Tab away and back; the camera does not move.
- **Risk**: low.

### [x] 4.5 `SplatIndex` correctness and memory — P2

- **Evidence**: `src/render/splatIndex.ts:5` `MAX_AXIS = 160` → up to 4.1M cells for cubic scenes (`hist`, `offsets`, `cursor`, `seen`, each 16 MB) on top of `indices` (4 B/splat, 56 MB at 14M), none counted in the decode budget. `:357` stores the world matrix as `Float32Array` (loses a large origin; see 2.6/2.7). `:363` uses `numSplats` with `packedArray` even for paged Spark meshes, whose `packedArray` is a page buffer, not the scene. `SceneHost.frameAll` rebuilds the index on every up-axis change even though matrices are unchanged.
- **Fix**:
  1. Cap cells: `cells ≤ max(4096, count / 8)`. Derive `cell` from `cbrt(volume / maxCells)` and then clamp each axis to `MAX_AXIS`.
  2. Skip sources where `(object as SplatMesh).paged` is truthy (picking falls back to bounds/pivot as today).
  3. Use `Float64Array.from(object.matrixWorld.elements)`.
  4. In `SceneHost.frameAll`, skip `startIndex` when every renderable's `matrixWorld` equals the one used for the current index (store a version counter bumped by `setFlip`).
  5. Add `4 * count + 16 * cells` to the reported memory in `estimateGpuBytes`, or a separate "CPU index" stat.
- **Verify**: extend `tests/splatIndex.test.ts`: 1M random points in a cube produce at most 125k cells, and the pick result still matches brute force within 1 px tolerance. A translated source (position 4.5e6) still picks within 1e-3.
- **Risk**: low.

### [x] 4.6 Double-tap to focus on touch — P2

- **Evidence**: focus is `dblclick` only (`Navigation.ts:444-449`). With `touch-action: none` (`styles.css:56`), mobile browsers do not reliably synthesise `dblclick`, so touch users cannot focus.
- **Fix**: in `onPointerUp` for `pointerType === 'touch'` with no drag (drag still `'arm'`), record `{ time, x, y }`. A second tap within 300 ms and 24 px calls `focusOn(query(x, y).point)`.
- **Verify**: manual on a phone; desktop `dblclick` is unchanged.
- **Risk**: low.

---

## Batch 5 — PWA, build, and CI hygiene

### [x] 5.1 Offline launch breaks after 10 minutes — P1

- **Evidence**: `vite.config.ts:53-62`. The navigation route is `NetworkFirst` with `expiration: { maxAgeSeconds: 600 }`, and `navigateFallback: undefined`. Workbox's expiration plugin refuses to serve an expired entry, so an installed PWA opened offline more than 10 minutes after the last visit shows the browser offline page.
- **Fix**: `maxAgeSeconds: 60 * 60 * 24 * 30`. NetworkFirst still prefers the network when online, so deploys stay visible.
- **Verify**: `npm run build && npm run preview`. Load once, wait 11 minutes (or temporarily set the clock forward), switch DevTools to Offline, and reload: the app shell loads.
- **Risk**: low.

### [x] 5.2 Precache size guard and update registration errors — P2

- **Evidence**: `vite.config.ts:51` `maximumFileSizeToCacheInBytes: 6 MiB`, while the main chunk is already 3.18 MB. If a Spark upgrade crosses 6 MB, Workbox silently drops the main chunk from precache and offline breaks. `src/app/registerUpdate.ts:93-101` has no `.catch`; in `npm run dev` (no `sw.js`) and on registration failures this is an unhandled rejection.
- **Fix**:
  1. Add `scripts/check-precache.mjs`: read `dist/sw.js`, assert every `dist/assets/index-*.js` and `*.worker-*.js` filename appears in the precache manifest. Run it in CI after build (`"postbuild": "node scripts/check-precache.mjs"`).
  2. Append `.catch((error) => console.warn('Service worker registration failed', error))`.
  3. Enable `@typescript-eslint/no-floating-promises` in `eslint.config.js` (needs `parserOptions.projectService: true` for `src/**/*.ts`) and fix what it reports.
- **Verify**: CI green. Set the limit to 1 MB locally and confirm the check fails.
- **Risk**: low. Type-aware lint slows lint by a few seconds.

### [x] 5.3 Deploy only what passed CI — P2

- **Evidence**: `.github/workflows/pages.yml` builds and deploys on every push to `main` independently of `ci.yml`. A red lint, typecheck, or test still deploys.
- **Fix**: in `pages.yml`, add the `npm run lint`, `npm run typecheck`, and `npm test` steps before `npm run build` (simplest), or trigger Pages via `workflow_run` on CI success.
- **Verify**: push a branch with a failing test to a fork's `main`; no deploy.
- **Risk**: low.

### [x] 5.4 Browser smoke test in CI — P2

- **Evidence**: all tests run in node (`vite.config.ts:75-78`). Nothing exercises worker bundling (`new URL('../../workers/…', import.meta.url)`), Spark init, or the loaders end-to-end. `BENCHMARK.md` shows SwiftShader runs work in this environment.
- **Fix**: add `@playwright/test` (chromium only) and `tests-e2e/smoke.spec.ts`. Start `vite preview`; for each of `?sample=torus-ply`, `torus-splat`, `cloud`, `crate`, `sphere`, and `?demo=slab`, wait for `#loading[hidden]`, assert no console errors, and assert `#hud-splats` / `#hud-points` / `#hud-tris` is non-zero for the matching kind. Launch args: `--use-angle=swiftshader --enable-unsafe-swiftshader`. Add a CI job `e2e` after `check`.
- **Verify**: the job passes on `main`. Break the worker URL path locally and confirm it fails.
- **Risk**: low. It adds about 1–2 min of CI time; keep it to these six loads.

### [x] 5.5 Small cleanups — P2 (one PR)

- `src/core/memoryBudget.ts:28`: `(cores <= 4 && mobileUa)` is redundant with `mobileUa`; `:49` `gb <= 4 ? 1.5M` is dead because `lowRam` already routes those devices to mobile. Simplify and keep the tests passing.
- `ViewerApp.ts:180,188,371`: wrap `localStorage.setItem` in `try` (quota and private-mode failures).
- Lazy-load `GLTFLoader` / `OBJLoader` with `await import(...)` inside `meshLoader.load` to trim the boot chunk.
- `SceneHost.dispose` should also dispose the pivot marker geometry and materials, the grid, and `this.spark.dispose()` (for future HMR or embed use).

---

## Summary

The pipeline is in good shape: chunked worker decoding, a budget planner, an incremental pick index, and idle frames are the right architecture, and the baseline is green. The work that matters most, in order:

1. **1.2 (P0)**: free the old scene before a large load. Reloading a multi-GB scene today needs about 2× peak memory and can kill the tab.
2. **2.1 / 2.2 (P1)**: fix the decode planner. Mobile gets SH0 + half-float centers when it could afford far more; the 14M desktop case spends memory on SH2 instead of the LoD tree that makes it real-time; and the LoD memory factor is underestimated.
3. **3.1 (P1)**: the LoD slider is squared (plus a per-mesh factor), so detail and GPU load scale quadratically.
4. **3.2 (P1)**: idle skipping stalls paged `.rad` refinement.
5. **2.3 (P1)**: `getBoundingBox` walks every splat on the main thread on each load, flip, and up-axis change, and floaters wreck framing.
6. **1.3 / 1.4 / 1.6 (P1)**: lifecycle leaks: Spark fallback meshes on abort, point-cloud workers, mesh textures.
7. **1.5 / 2.4 (P1)**: URL loads are killed after 3 minutes and fully buffered (OOM on iOS); use a stall watchdog and Range streaming.
8. **4.1 (P1)**: since the stable-pivot change, pan uses the pivot direction, not camera axes, so the grabbed point drifts.
9. **1.7, 5.1 (P1)**: no WebGL context-loss recovery; the PWA cannot launch offline after 10 minutes.
10. **1.1 (P1)**: pin Spark exactly and add a bit-layout parity test, because the worker re-implements Spark's encoding.

Suggested PR order: 1.1 → 1.2 → 3.1 → 3.3 → 3.2 → 1.3 → 1.4 → 1.5 → 1.6 → 2.1 → 2.3 → 4.1 → 5.1 → 1.7 → 2.2 (after measuring) → 2.4 → 2.6 → the remaining P2 items.
