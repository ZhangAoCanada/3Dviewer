# Navigation feel and motion artifacts plan

## Status

Batch 1 is done. Batch 2 is not started: it waits for the owner's measurements in `BENCHMARK.md`.

This plan covers two complaints from the owner's test on desktop Chrome with a 3.3 GB, 14,161,020-splat SH3 drone scan (EPSG:4547, Z-up, flat, about 590 × 490 × 77 m). The planner chose extended SH2 (about 1.07 GB) with no LoD, and the view ran at about 26 fps.

1. **Drag "sometimes feels off"**: how the pivot is chosen and how the drag moves the camera.
2. **Fast drags take about a second to "catch up"**, with visible 3DGS artifacts in the meantime.

Audited at `main` = `714f045`. Spark is pinned to `@sparkjsdev/spark` **2.2.0**. Spark line numbers refer to `node_modules/@sparkjsdev/spark/dist/spark.module.js`. Repo line numbers refer to `714f045`; if they have moved, search for the quoted symbol.

## Root causes in one paragraph each

**Navigation.** The biggest cause is a bug. The splat pick grid caps each axis at 160 cells but never enlarges the cell to compensate. On this scene it covers only 372 × 372 m of the 590 × 490 m footprint. On roughly half the scan, a click misses the grid, and the coarse fallback is disabled once the grid exists. The pivot then lands on the top face of the bounding box, up to 77 m in the air. Orbit then swings around an empty point, pan moves at the wrong speed, and zoom slows down and passes through the ground. Four smaller causes add to it:

- The pick takes the nearest single splat center, so one stray floater captures the pivot.
- A per-event rotation clamp throws away part of every fast drag at 26 fps, because pointer events arrive once per frame.
- The camera can orbit under the terrain.
- Wheel zoom jumps 32% per notch with no smoothing.

**Motion.** Spark sorts on a single track. Each sort reads back a depth for all 14.2M splats from the GPU, radix-sorts them in one WASM worker, and uploads a 14.2M-entry order texture. The next sort starts only when the previous one finishes. While the camera moves, every frame is blended in the order computed for an older camera position. After release, the orbit coast runs for about 0.8 s, then one or two more sort cycles follow. That adds up to the "about a second". LoD is not involved, because this scene has no LoD tree. There is no Spark setting that makes a 14M sort cheaper. The only large lever is to sort fewer splats, which means LoD, and LoD needs memory (task 2.2 of `docs/AUDIT_PLAN.md`).

## How to use this plan

- Two batches. Each batch is **one PR**. Inside a batch, tasks are in priority order.
- Batch 1 is pure navigation work plus measurement hooks, with no memory risk. Batch 2 changes the decode policy. It lands only after the owner records the Batch 1 measurements in `BENCHMARK.md`.
- Severity: **P0** = broken on the primary use case, **P1** = clearly felt, **P2** = polish.
- Keep the idle-frame contract: anything that changes the image sets `SceneHost.viewDirty` or keeps `navigation.isMoving()` true (`SceneHost.needsDraw`, `src/render/SceneHost.ts:435`).
- Run before and after each batch: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Reference behavior (Google Earth web, Sketchfab, SuperSplat)

| Behavior | Google Earth web | Sketchfab | SuperSplat | This viewer today |
|---|---|---|---|---|
| Orbit center | Point under the cursor or screen center, always on terrain | Fixed target, set by double-click | Fixed target, set by focus or double-click | Point under the cursor, re-picked each drag |
| Click on sky or a hole | Keeps the previous center | Fixed target | Fixed target | Box face or pivot-plane point in the air |
| Tilt limit | Never below the horizon | None | None | 6.9° short of straight up from below |
| Pan | Grabbed ground point stays under the cursor, altitude constant | Screen plane | Screen plane | Screen plane at the anchor depth |
| Wheel | Smoothed, distance-proportional | Smoothed | Smoothed | Instant, 32% per notch |
| Inertia | Short | Short damping | Damping | About 0.8 s coast |

The target feel is Google Earth for flat scenes (terrain), and the current object-viewer behavior for everything else. "Flat" means the scene's thickness along its up axis is at most 0.28 of its widest side (the same test as `detectUpAxis`, `src/render/cameraMotion.ts:22-30`).

---

## Batch 1: Navigation feel and motion measurement (one PR)

### 1.1 The pick grid covers only part of large flat scenes — P0

- **Evidence**:
  - `src/render/splatIndex.ts:6`: `MAX_AXIS = 160`.
  - `gridFor` (`splatIndex.ts:478-494`) computes `cell = cbrt(volume / maxCells)`. `axisCount` (`:473-475`) then clamps each axis count to 160 without growing `cell`. For 590 × 490 × 77 m and 14.2M splats, `maxCells = 1.77M`, `cell = 2.32 m`, and `nx = ny = 160`. The grid covers 372 × 372 × 79 m, which was checked numerically.
  - Splats beyond 372 m are clamped into the last column (`cellOf`, `:337-345`). `pick` ray-tests only the truncated box (`:95-99`).
  - When `this.index` exists, the coarse picker is disabled (`SceneHost.ts:308`: `this.index ? null : this.coarse`). A miss therefore falls through to the bounds fallback, `scenePick.ts:78-84`: the box entry point `tNear` (the box top, in the air) or half of `tFar`.
- **Root cause**: about 52% of the footprint (1 − 372²/(590 × 490)) has no usable pick. There the pivot, the pan anchor, and the zoom anchor are all wrong, and the wrong point depends on where the user clicks. That is exactly "sometimes off". Before the index finishes building, the coarse picker handles these areas, so the behavior also changes a minute after load.
- **Fix** (`splatIndex.ts`):
  1. Set `MAX_AXIS = 1024`. The cell budget `max(4096, count / 8)` still bounds memory.
  2. In `gridFor`, right after the `cbrt` line and its finiteness guard, add `cell = Math.max(cell, Math.max(sx, sy, sz) / MAX_AXIS);`, so `n*cell >= size` holds on every axis.
  3. Export `gridFor` for tests. Give `SplatIndexJob` and `SplatIndex.fromPositions` an optional `maxCells` argument, test-only, defaulting to `max(4096, count / 8)`, so a small test can reproduce the 14M grid.
- **Verify**:
  - New tests in `tests/splatIndex.test.ts`: `gridFor((590, 490, 77), 14_161_020)` gives `nx*cell >= 590`, `ny*cell >= 490`, `nz*cell >= 77`, `nx*ny*nz <= 1_770_128`, and every axis `<= 1024`. Add the same assertions for `(5000, 10, 10), 2e6` and `(1, 1, 1), 100`.
  - End-to-end pick test: `SplatIndex.fromPositions` on a 296 × 246 grid of points spaced 2 m at z = 0 (590 × 490 m), plus one point at z = 77, with `maxCells = 1_770_128`. A downward ray from (585, 485, 200) hits z ≈ 0, within 0.05. This fails on `main`.
  - The existing index tests still pass.
  - Owner: drag on the far corners of the scan (east and north edges). The ring should sit on the ground, not in the air, and zoom there should stop at the surface.
- **Risk**: low. With 1.77M cells, memory is about 14 MB steady plus about 14 MB while building, already counted at 16 B per cell in `estimateGpuBytes` (`SceneHost.ts:505`). Smaller cells make picks cheaper, not dearer.

### 1.2 One stray floater captures the pivot — P1

- **Evidence**: `SplatIndex.pick` (`splatIndex.ts:113-128`, `:182`) returns the nearest center within `NEAR_PIXELS = 3.5` px, else the nearest within `FAR_PIXELS = 14` px. A single center is enough, it is not weighted by opacity, and the search stops at the first hit (`limit()`, `:112`).
- **Root cause**: drone scans have isolated, often semi-transparent floaters between the camera and the ground. When one is under the cursor, the pivot jumps to a point a few metres from the camera, and the next drag swings the view violently. A low-opacity center is also picked even when it is invisible.
- **Fix** (`splatIndex.ts`):
  1. **Opacity**: store an opacity reader per source.
     - Packed: `(packed[o] >>> 24) / 255`.
     - Ext: the low 16 bits of word 3 of `extArrays[0]` as half float (`writeExtSplat`, `src/loaders/gaussian/packSplat.ts:303`). Add a `Uint32Array` view `extBits` to `IndexSource` alongside `ext`.
     - Points and meshes: always 1.
     - In `consider`, skip centers with opacity `< MIN_PICK_OPACITY = 0.1`.
  2. **Support**: collect candidates within `FAR_PIXELS` into a preallocated `Float64Array(2048)` of `t` values, with a parallel `Uint8Array` near flag. Stop collecting when it is full.
     - A candidate at depth `t` is *supported* when at least `MIN_SUPPORT = 3` candidates have `|t_i − t| <= w`, with `w = max(0.02 * t, 2 * FAR_PIXELS * worldPerPixel(t))`.
     - Result: the smallest supported near `t`; else the smallest supported far `t`; else today's answer (nearest near, else nearest far), so sparse scenes and tests keep working.
  3. **Early stop**: replace `limit()` with `stopT`, which starts at `Infinity` and becomes `bestSupported + w` once a supported candidate exists. Re-check support only when a candidate was added in that DDA step (sort the filled prefix; n ≤ 2048). Keep `MAX_TESTS`.
- **Verify** (`tests/splatIndex.test.ts`):
  - A 200 × 200 slab spaced 0.5 m at z = 0, plus one floater at (0, 0, 20). A ray from (0, 0, 100) straight down returns z ≈ 0, within 0.05.
  - A tight blob of 6 points at z = 20 under the same ray returns z ≈ 20. A deliberate dense object still wins.
  - A packed source with the floater's alpha byte set to 10 and the slab at 255 returns z ≈ 0 even with `MIN_SUPPORT = 1` (an opacity-only check).
  - Existing pick tests are unchanged.
  - Owner: orbit near the drone's flight altitude where floaters are visible. The ring should no longer land on them.
- **Risk**: low to medium. A thin isolated feature (a cable) with fewer than 3 centers under the cursor falls back to today's behavior rather than being skipped. Cost: at most 2048 extra stores and a few small sorts per pick.

### 1.3 Misses: ground plane on flat scenes, keep the pivot on sky — P1

- **Evidence**:
  - `pickScene` (`src/render/scenePick.ts:77-95`) falls back to the box entry point, or to the pivot plane.
  - `NavigationController.query` (`src/render/Navigation.ts:234-238`) and `armDrag` (`:316-326`) use whatever comes back. `onPointerMove` (`:341-347`) makes it the pivot.
  - Home `frame()` puts the pivot at the box center, mid-height (`:126`), which is about 38 m above the ground here.
- **Root cause**: after 1.1 and 1.2, a miss means sky, a hole, or beyond the scan edge. Picking a point in the air there moves the orbit center somewhere arbitrary, and it changes on every drag (the "pivot jumping between drags").
- **Fix**:
  1. In `PickResult` (`Navigation.ts:16-19`) and `SceneHit` (`scenePick.ts:42-45`), add `kind: 'surface' | 'ground' | 'none'`. Keep `surface` as `kind === 'surface'`.
  2. In `SceneHost`, add `flat: boolean` and `groundLevel: number`, both set in `frameAll` (`SceneHost.ts:222-244`).
     - `flat = thickness along up / max other extent <= 0.28`. Add `isFlatScene(size, up)` next to `detectUpAxis` in `cameraMotion.ts`.
     - `groundLevel` = the median up-coordinate of the coarse samples (`collectCoarsePoints`), computed in `rebuildCoarse`.
  3. In `SceneHost.pick`, when the index or mesh pick fails and `flat` is true, intersect the ray with the plane `up · p = groundLevel`. Add the pure helper `groundPlaneHit(origin, dir, up, level, maxT)` in `cameraMotion.ts`.
     - Accept the hit when `t > 0` and `t <= 4 * sceneRadius`. Return `kind: 'ground'`.
     - Otherwise call `pickScene` with `bounds = null` for flat scenes, so the fallback is the pivot plane, and return `kind: 'none'`. Non-flat scenes keep the bounds fallback, with `kind: 'none'`.
  4. In `armDrag`, for `kind === 'orbit'` and `hit.kind === 'none'`, keep `armedPoint = this.pivot`, so the orbit center does not move. Pan and wheel keep using `hit.point`, because the pivot-plane point lies under the cursor at a sensible depth.
  5. In `frame()`, when `flat`, set the home pivot's up-coordinate to `groundLevel`. Add an optional `groundLevel` argument to `frame(box, groundLevel?)`.
- **Verify**:
  - Unit tests for `groundPlaneHit`: a hit in front, `null` behind or parallel, and `null` beyond `maxT`.
  - Unit test for `isFlatScene` with (590, 490, 77) and Z up (true), and with a 1 m cube (false).
  - Extract `chooseOrbitPivot(hit, currentPivot)` as a pure function and test that `kind: 'none'` returns the current pivot.
  - Owner: start drags on the sky and beyond the scan edge. The orbit continues around the previous center, with no jump. Start drags in small holes in the scan: the ring lands on the ground plane, in amber (see 1.8).
- **Risk**: low. A median ground level is wrong for scans that are mostly roofs, but it is only used after a real miss.

### 1.4 The per-event rotation clamp drops part of fast drags at low fps — P1

- **Evidence**: `Navigation.ts:361-362` clamps yaw to ±0.18 rad and pitch to ±0.16 rad per `pointermove`. Chrome aligns `pointermove` to animation frames, so at 26 fps each event carries one frame of motion. A 1000 px/s drag is 38 px per event, or 0.20 rad at 0.0052 rad/px, so it is clamped. `blendReleaseVelocity` (`cameraMotion.ts:157-160`) then also sees the clamped angle, and `RELEASE_DT_MAX = 1/20` (`:154`) overstates speed below 20 fps.
- **Root cause**: at the frame rate this scene runs at, the scene slips under the hand on fast drags. How much is lost depends on fps, so it feels inconsistent.
- **Fix**:
  1. Add `export function orbitDelta(dx, dy, sensitivity): { yaw; pitch }` in `cameraMotion.ts`, with `YAW_PER_PX = 0.0052`, `PITCH_PER_PX = 0.0042` (unchanged), and a guard clamp of `MAX_ORBIT_STEP = 0.9` rad per event, which only catches capture glitches. Use it at `Navigation.ts:361-362`.
  2. Set `RELEASE_DT_MAX = 1 / 10`. Clamp the release velocity to `±6` rad/s in `blendReleaseVelocity`.
- **Verify**: unit tests show `orbitDelta(120, 0, 1).yaw === -0.624`, `orbitDelta(400, 0, 1).yaw === -0.9`, and a 70 ms sample stream gives the same velocity as a 35 ms stream at equal angular speed. The existing release-velocity test still passes. Owner: a fast flick at 26 fps turns as far as the same flick on a light scene.
- **Risk**: low.

### 1.5 Orbit can go under the terrain — P2

- **Evidence**: `cameraMotion.ts:4-5` sets `MAX_POLAR = π − 0.12`, so the camera can drop to 83° below the pivot's horizon. `pitchDelta` (`:180-187`) uses the constant.
- **Root cause**: on a flat scan, a pitch drag ends up under the ground looking at the back faces of splats. Google Earth stops at the horizon.
- **Fix**:
  1. Add an optional `maxPolar = MAX_POLAR` parameter to `orbitAround`, `orbitCamera`, and `pitchDelta`.
  2. Add `maxPolar` to `NavigationController`, set in `frame()`: `flat ? Math.PI / 2 + 0.05 : Math.PI - 0.12`. Pass it in both `orbitCamera` calls (`Navigation.ts:190`, `:363`). The existing clamp logic already allows moving back into range when the camera starts outside it.
- **Verify**: unit test that from polar 80°, 100 steps of downward pitch (`pitch = -0.05`) with `maxPolar = π/2 + 0.05` end at a polar within 1e-6 of the limit, and that yaw still works there. The existing nadir and flip tests pass unchanged with the default. Owner: dragging up hard stops at about the horizon, slightly below it.
- **Risk**: low. Object scenes are unchanged.

### 1.6 Inertia length, wheel smoothing, pinch gain — P1

- **Evidence**:
  - `INERTIA_DECAY = 5.2` (`Navigation.ts:22`). The coast stops when `|v| / decay < 0.01` (`:184-189`). From 4 rad/s that takes 0.84 s and turns another 0.77 rad, and the whole time the depth order is stale (see the Motion root cause).
  - Wheel: `wheelNotches` (`cameraMotion.ts:227-230`) maps 100 px to 1 notch, and `zoomToward` applies `exp(-0.38)`, which is 32% per notch, instantly in the event handler (`Navigation.ts:437-460`).
  - Trackpad pinch on Chrome, Edge, and Firefox arrives as `wheel` with `ctrlKey`. Chromium sets `deltaY ≈ −100·ln(scale)`. It goes through the same 0.38 mapping, so the zoom follows the fingers at only about 0.38× their scale.
- **Root cause**: a long coast stretches the window in which artifacts show. Instant 32% jumps at 26 fps look like teleporting. Pinch feels sluggish.
- **Fix**:
  1. Set `INERTIA_DECAY = 7`. From 4 rad/s the coast now takes 0.58 s and turns 0.57 rad.
  2. Smooth the wheel.
     - New fields: `zoomPending`, `zoomAnchor: Vector3`, `zoomSurface`.
     - `onWheel` (non-ctrl): cache the hit as today, set the anchor and surface from it, and add `zoomPending += -wheelNotches(...)`.
     - In `update(dt)` (orbit mode, not animating): `step = zoomPending * (1 - Math.exp(-dt / 0.07))`, call `zoomToward(..., step, ...)`, then `zoomPending -= step`. Snap to 0 below 1e-3.
     - `isMoving()` returns true while `|zoomPending| > 1e-3`. `pointerdown`, `startAnim`, and `setMode` clear it.
  3. Change the divisor in `wheelNotches` from 100 to 125: 26% per mouse notch.
  4. Pinch: when `event.ctrlKey && event.deltaMode === 0`, apply immediately with `notches = (-event.deltaY * PINCH_K) / (0.38 * this.sensitivity)`, where `PINCH_K = 0.01`. The zoom factor then equals the fingers' scale.
- **Verify**:
  - Pure helper `smoothZoomStep(pending, dt, tau)`. A test checks that 1 notch applied over 0.5 s at 30 Hz and at 120 Hz both deliver ≥ 0.999 of the notch, and that the totals differ by < 1e-3.
  - A `wheelNotches` test: 125 px gives 1.
  - Owner, with a mouse: zoom glides instead of stepping. With a trackpad pinch: the content follows the fingers. If pinch is still off, tune only `PINCH_K`. Flick-orbit: the coast is shorter, and the scene settles sooner.
- **Risk**: low. Smoothing adds about 70 ms of latency to wheel zoom, which is standard for this kind of viewer.

### 1.7 Ground-grab pan on flat scenes — P1

- **Evidence**: `panInViewPlane` (`cameraMotion.ts:130-151`) moves along the camera's right and up axes at the anchor depth. In an oblique terrain view, a vertical drag therefore changes altitude and moves the camera toward or away from the ground.
- **Root cause**: users expect the grabbed ground point to stay under the cursor while the camera slides at constant height, as in Google Earth and map apps. View-plane pan keeps the point under the cursor too, but it moves the camera along the wrong surface.
- **Fix**:
  1. Add `panOnPlane(camera, pivot, anchor, rayDir, up): boolean` in `cameraMotion.ts`:
     - Use the plane `up · p = up · anchor`, and `t = up·(anchor − camera.position) / up·rayDir`.
     - Reject (return false) when `up·rayDir > −0.087`, which is 5° below the horizon, or when `t <= 0`, or when `t > 6 · |anchor − camera.position|`.
     - Otherwise `delta = anchor − (camera.position + t·rayDir)`. Cap `|delta|` at `0.5 · |anchor − camera.position|`, and add `delta` to both the camera and the pivot.
  2. In `onPointerMove` pan (`Navigation.ts:370`): when `flat`, build the cursor ray. Add an `unproject` helper on the controller, using `camera` and `dom.getBoundingClientRect()`. Try `panOnPlane`, and fall back to `panInViewPlane` when it returns false.
  3. Touch pinch-pan stays on `panInViewPlane`.
- **Verify**: unit tests show that after `panOnPlane` the camera's up-coordinate is unchanged within 1e-9, and the anchor lies on the new cursor ray within 1e-6 · distance. A near-horizontal ray returns false. The existing pan tests are unchanged. Owner: right-drag on the ground in an oblique view. The ground stays glued to the cursor, altitude stays constant, and near the horizon the pan falls back without jumps.
- **Risk**: medium. This changes the feel. It is only active for flat scenes, and object scenes are untouched.

### 1.8 Pivot ring feedback — P2

- **Evidence**: the ring shows only once an orbit drag starts (`Navigation.ts:345-346`) and hides in `endDrag` (`:248-253`), even while the coast continues. It has one color (`SceneHost.ts:556-588`).
- **Fix**:
  1. Change `onPivot(point, kind)` to pass `kind`. Mint `0x7ee0c6` for `surface`, and amber `0xf2b45a` for `ground` or a kept pivot (`none`). Set the color on both ring materials.
  2. Show the ring at the anchor during pan. For wheel zoom, show it at `zoomAnchor` and hide it 350 ms after the last wheel event (`pivotHideAt` checked in `update`).
  3. Keep the ring visible during the orbit coast. Hide it when the velocity reaches zero in `update`, or on the next `pointerdown`.
- **Verify**: owner check. An orbit on the ground shows mint; on sky it shows amber at the old pivot. A flick shows the ring until the coast stops.
- **Risk**: low. A visible ring forces redraws (`needsDraw`), which is already the case during drags.

### 1.9 The pick index builds slowly while the user is moving — P2

- **Evidence**: `SceneHost.ts:357` calls `indexJob.pump(draw ? 0.35 : 1.4)`. Chunks are 24,000 splats (`splatIndex.ts:280`, `:320`), so one chunk already overruns 0.35 ms. Two passes over 14.2M are about 1,180 chunks, which at 26 fps is about 45 s of interaction before fine picking is available. Until then, picks use the 24k-sample coarse surface, so the pick behavior changes mid-session.
- **Fix**:
  1. Change to `pump(draw ? 2 : 6)`, and change the chunk size from 24,000 to 8,000.
  2. Expose `SplatIndexJob.progress` (0–1, hist and fill weighted equally). Show "Pick index: building 43% / ready" in the scene info panel.
- **Verify**: a unit test that one `pump(0.01)` on a 1M-point job advances `progress` by exactly one 8,000-splat chunk, `8000 / (2 * 1e6)`. Owner: the index reaches "ready" within about 15 s of orbiting, or about 3 s idle.
- **Risk**: low. It adds at most 2 ms to a 38 ms frame while building.

### 1.10 Motion measurement hooks, which are task 2.2 step 1 — P1

This task does not fix anything. It turns "about a second" into numbers and lets the owner measure LoD memory on the real file without changing the default policy.

- **Evidence**:
  - Spark sets `lastSortTime` at the start of every sort (`spark.module.js:13965`) and chains sorts back-to-back (`:14040`). While the camera moves, the interval between starts is the full cycle: depth readback, worker sort, and order upload.
  - The LoD worker logs `Tiny LoD: N -> M (t ms)` in the inline worker source (`:8834`, `tinyLodExtSplats`).
  - `docs/AUDIT_PLAN.md` task 2.2 is still open.
- **Fix**:
  1. Add `src/render/sortTimer.ts`: a `SortIntervalTracker` with `sample(lastSortTime, now)` and `ms`. It keeps an EMA (α = 0.3) of successive `lastSortTime` deltas below 3000 ms, and resets after a 3 s gap.
     - In the `SceneHost` frame loop, read `(this.spark as unknown as { lastSortTime?: number }).lastSortTime`.
     - Add `sortMs` to `FrameStats`, and show a "Sort" row in the stats detail (`ViewerApp.ts:1143` area), with "—" when there is no recent sort.
  2. URL overrides, read once in `ViewerApp`'s load path and passed through `LoadContext` to the worker plan:
     - `?lod=force` makes `planGaussianDecode` set `lod = decodedCount >= LOD_ABOVE` and ignore memory.
     - `?sh=0|1|2|3` caps `shCap`.
     - Add `overrides?: { forceLod?: boolean; maxSh?: ShDegree }` to the planner arguments.
  3. After `createLodSplats` (`gaussianLoader.ts:207`), record `lodCount = (mesh.extSplats?.lodSplats ?? mesh.packedSplats?.lodSplats)?.numSplats ?? 0` in `GaussianSceneInfo`. Show "LoD splats: N (×ratio)" in scene info. Add `estimateDecodedBytes(lodCount, shDegree, extended)` to `getStats().memoryBytes` (`gaussianRenderable.ts:61`).
  4. Add a `BENCHMARK.md` table, with one row per run of the 14.2M scan:
     - Columns: run, decoded SH, LoD (on or off), `lodCount / count`, peak and steady memory (Chrome Task Manager, tab plus GPU process), fps while orbiting, sort ms while orbiting, catch-up time.
     - Runs: default, `?lod=force&sh=1`, and `?lod=force&sh=0`.
     - Also record `lodCount / count` for the torus sample and `?demo=slab&n=1500000`.
- **Verify**:
  - Unit test of `SortIntervalTracker` with the synthetic starts 0, 400, 800, 1200 ms giving `ms ≈ 400`. A 5 s gap resets it.
  - Planner tests: `forceLod` gives `lod === true` for 14.2M on the 8 GB desktop budget, and `maxSh: 1` gives `shDegree <= 1`. Without overrides, the existing 14.2M expectations are unchanged.
  - Owner: fill in the table. If `?lod=force&sh=1` crashes the tab, record that too. It sets the speed ceiling in 2.1.
- **Risk**: low. The overrides are URL-only. A forced LoD can exceed memory on a small machine, which is the purpose of the measurement.

---

## Batch 2: Motion, by sorting fewer splats on very large scenes (one PR, after the Batch 1 measurements)

### Why LoD, and what was ruled out

The full sort cycle for this scene is in Spark's `driveSort`, `spark.module.js:13946-14041`:

- **Depth readback**: `readbackDepth` (`:14415`) reads 4 B per splat over 16.78M padded slots, about 67 MB per sort.
- **Worker sort**: `sortSplats32` (`:13991`) is a single-threaded WASM radix sort over all active splats.
- **Order upload**: `uploadU32DataTextureRows` (`:14019-14030`) uploads the order texture, about 57 MB.
- **Chaining**: only one sort is in flight (`if (this.sorting ...) return`, `:13947`).

The radial metric is `length(center − viewCenter)` (`:1808`), and orbiting moves the camera center by about pivot distance × angle, so the order goes stale quickly. `generate()` runs every moving frame (`:13923`) and updates colors, but not the order. With no LoD, `driveLod` finds no LoD meshes (`:14094-14096`), so nothing is refining. The lag is pure sort latency.

| Option | Verdict |
|---|---|
| `minSortIntervalMs` (desktop 0, mobile 33; `SceneHost.ts:121`, default `:13570`) | Already 0 on desktop. Raising it only adds latency. Keep. |
| Z sort instead of radial (`:1810-1812`) | Same cost, still all splats. Radial is invariant to pure camera rotation, so it is the better default. Keep radial. |
| Coarser 16-bit sort while moving | Spark 2.2 ships `sortSplats16` in the worker but `SparkRenderer` only calls `sortSplats32`. It would need a Spark fork. Rejected. |
| `readPause` (1 ms default, `:13543`) | Negligible. |
| Lower DPR while moving | Helps fps, not the sort. Every switch reallocates the framebuffer (audit 3.3) and changes `renderSize`, which marks LoD dirty. Rejected. |
| Subsample (1 of 2) while moving | No Spark mechanism without LoD. Visible holes. Rejected. |
| Bake a paged `.rad` (Spark `build-lod`) | Best result with zero code: LoD plus bounded memory. Recommended to the owner in parallel (2.4). |
| **LoD from the decoded PLY** | The sorted and drawn count becomes `lodSplatCount × lodSplatScale = 2,500,000` (`memoryBudget.ts:48`, `lodParams.ts`, `spark.module.js:14057-14059`), 5.7× fewer than 14.2M. Expected: sort latency drops by roughly 5×, so catch-up falls from about 1 s to well under 0.3 s together with 1.6, and fps rises substantially from 26 (both to be measured with 1.10). Cost: memory, below. |

**Memory for this scene** (padded 16.78M slots, extended encoding required because half-float centers quantize to about 0.25 m at ±300 m):

| Plan | Base | Peak while building LoD = (2 + R) × base | Steady = (1 + R) × base |
|---|---|---|---|
| Today: ext SH2, no LoD | 1.07 GB | — | 1.07 GB |
| ext SH1 + LoD | 0.81 GB | 2.7 GB (R = 1.4) to 3.1 GB (R = 1.8) | 1.9 to 2.3 GB |
| ext SH0 + LoD | 0.54 GB | 1.8 to 2.0 GB | 1.3 to 1.5 GB |

`R = lodCount / count`. The estimate of 1.4–1.8 assumes `lodBase = 1.5` on a mostly 2D surface; 1.10 measures it. The "2" in the peak column comes from `ExtSplats.createLodSplats`, which `slice()`s every array before sending it to the worker (`:10673-10682`) and keeps the original (`nonLod = true`, `:10700`). The desktop budget at Chrome's `deviceMemory` cap of 8 is `cpuBytes = 1.89 GB` (`memoryBudget.ts:43`), and the LoD headroom is 0.85 × that, which is 1.6 GB. **Neither LoD option fits the current budget**, so LoD for this file has to be an explicit opt-in.

Two further facts the planner must respect:

- **SH3 is dropped**: `ExtSplats.createLodSplats` copies only `extra.sh1`, `sh2`, and `sh3`, not `sh3a` and `sh3b` (`:10678-10682`). Extended plus LoD must cap SH at 2.
- **Picking still works**: the base arrays stay resident (`nonLod`), so `SplatIndex` keeps working with LoD on.

### 2.1 LoD-first planner with the measured factor (task 2.2 steps 2–4) — P1

- **Evidence**: `gaussianPlan.ts:17-19` and `:109-111` use `estimatedBytes * 2 <= cpuBytes * 0.85`. The note at `:126-128` is the message the owner saw.
- **Fix** (`gaussianPlan.ts`):
  1. Add `LOD_RATIO` (set it from the 1.10 table, rounded up to 0.1; until then 1.8), `LOD_PEAK_FACTOR = 2 + LOD_RATIO`, and `LOD_STEADY_FACTOR = 1 + LOD_RATIO`.
  2. Add a `policy: 'auto' | 'quality' | 'speed'` argument, defaulting to `'auto'`.
  3. **quality**: today's SH and encoding choice. `lod = decodedCount >= LOD_ABOVE && estimatedBytes * LOD_PEAK_FACTOR <= cpuBytes * LOD_HEADROOM`.
  4. **speed**, when `decodedCount >= LOD_ABOVE`:
     - Keep the encoding today's loop chose. Never switch extended to packed for speed.
     - Search `sh` from `min(shCap, extended ? 2 : 3)` down to 0 for the first value with `estimate(sh) * LOD_PEAK_FACTOR <= cpuBytes * SPEED_HEADROOM`, where `SPEED_HEADROOM = 1.6`, which is 3.0 GB at the cap.
     - If one is found: `lod = true`, `shDegree = sh`, and add the note "Spherical harmonics reduced to N so a level-of-detail tree fits. This load can use about X GB." (X = `estimate * LOD_PEAK_FACTOR`).
     - If none is found: fall back to the quality plan and add the note "Prefer speed needs more memory than this device reports."
  5. **auto**: use `speed` only when `decodedCount >= 4 * maxSplatsResident` (10M on desktop) **and** the speed plan fits `cpuBytes * LOD_HEADROOM`. Otherwise use `quality`. If quality has no LoD and `decodedCount >= 4 * maxSplatsResident`, append "Large scenes → Prefer speed turns on level of detail for smoother motion." For the owner's file, auto stays quality, because the speed plan does not fit 1.6 GB.
  6. The 1.10 `overrides` still win (`forceLod`, `maxSh`).
- **Verify** (`tests/gaussianPly.test.ts`), all with 14,161,020 splats, SH3, and the 8 GB desktop budget, with `preferExtended: true`:
  - `quality` gives today's result: ext SH2, `lod === false`.
  - `speed` gives `extended === true` and `lod === true`. With `LOD_RATIO = 1.8` the result is `shDegree === 0`; at 1.4 it is `shDegree === 1`. Assert against the constant: `estimate * LOD_PEAK_FACTOR <= cpuBytes * 1.6`.
  - `auto` equals `quality` for this case. A 3M-splat case is unchanged from today.
  - Extended SH3 with LoD is never produced.
- **Owner check**: load with Prefer speed. Record peak and steady memory, orbit fps, sort ms, and catch-up time in `BENCHMARK.md`. Compare roofs, water, and cars against Prefer quality for the visible SH loss.
- **Risk**: medium. Speed can use about 3 GB on a machine that really has 8 GB. That is why it is opt-in and the note states the number.

### 2.2 "Large scenes" setting: Auto / Prefer quality / Prefer speed — P1

- **Does it make sense?** Yes, as a **load-time** choice next to "Extended precision on next load" (`index.html:231`). For drone terrain, SH1 or SH0 loses only specular shimmer on roofs, water, and cars, while LoD cuts sorted splats about 5.7×. That directly addresses complaint 2 and raises fps. It cannot be a live toggle, because both SH bands and the LoD tree are fixed at decode.
- **Fix**:
  1. Add `largeScenes: 'auto' | 'quality' | 'speed'` to `RenderSettings` (`src/core/types.ts`), with default `'auto'` and persistence like the other settings.
  2. Add a `<select id="large-scenes">` under Advanced, labelled "Large scenes", with the hint "Applies on next load. Prefer speed builds a level-of-detail tree and lowers spherical harmonics; it can use about 3 GB while loading."
  3. Pass it through `LoadContext` → worker request → `planGaussianDecode({ policy })`.
  4. When the value changes while a gaussian scene with `sourceCount >= 4 * maxSplatsResident` is loaded, show the info toast "Reload the file to apply Large scenes."
- **Verify**: the planner tests from 2.1 cover the policy. Add a `ui-shots` screenshot of the Advanced section. Owner: toggling shows the toast, and a reload follows the setting.
- **Risk**: low.

### 2.3 Optional: smaller LoD budget while moving — P2, land only if measured

- **Evidence**: Spark re-traverses when `maxSplats` changes (`spark.module.js:14082-14083`), so `lodSplatScale` acts as a live budget. It only works when LoD exists. Without LoD there is no subset mechanism.
- **When**: only if, with Prefer speed, the owner still measures `sortMs > 60` while orbiting.
- **Fix**:
  1. Change `lodParams(budget, settings, moving)` to return `lodSplatScale * (moving ? MOTION_LOD_SCALE : 1)`, with `MOTION_LOD_SCALE = 0.6`.
  2. In `SceneHost`, compute `moving` as `navigation.isMoving()` with a 200 ms release delay. Write `spark.lodSplatScale` only when the value changes.
- **Verify**: a `lodParams` test checks the product equals `maxSplatsResident * s * 0.6` when moving. Owner: sort ms while orbiting drops by about 40%. Check that the detail pop at drag start and end is acceptable. If not, revert.
- **Risk**: medium. Visible LoD pops at the start and end of every drag. Each change also triggers a traversal, and Spark skips `generate` while a sort is running if the mapping changed (`:13918-13920`).

### 2.4 Point big-scene users to `.rad` and Prefer speed — P2

- **Evidence**: the load note "A level-of-detail copy did not fit beside it." (`gaussianPlan.ts:127`) gives no next step.
- **Fix**: when `!lod && decodedCount >= 4 * maxSplatsResident`, replace the note with "Sorting all N splats, so fast motion shows artifacts for a moment. Turn on Large scenes → Prefer speed, or bake a paged .rad with Spark build-lod." Keep the existing note text for `LOD_ABOVE <= count < 4 * maxSplatsResident`.
- **Verify**: planner test of the note text for 14.2M under `quality`.
- **Risk**: none.

---

## Summary

| Task | Area | Priority | Batch |
|---|---|---|---|
| [x] 1.1 Pick grid covers the whole scene | Pivot, pan, and zoom anchors | P0 | 1 |
| [x] 1.2 Floater-resistant pick | Pivot | P1 | 1 |
| [x] 1.3 Ground plane on flat scenes, keep pivot on sky | Pivot jumps | P1 | 1 |
| [x] 1.4 Remove the per-event orbit clamp | Drag tracking at low fps | P1 | 1 |
| [x] 1.5 Terrain pitch floor | Orbit | P2 | 1 |
| [x] 1.6 Inertia 7, smoothed wheel, pinch gain | Damping and zoom | P1 | 1 |
| [x] 1.7 Ground-grab pan on flat scenes | Pan | P1 | 1 |
| [x] 1.8 Pivot ring feedback | Feedback | P2 | 1 |
| [x] 1.9 Faster pick-index build | Pick consistency | P2 | 1 |
| [x] 1.10 Sort timer, LoD overrides, `lodCount` | Measurement (audit 2.2 step 1) | P1 | 1 |
| 2.1 LoD-first planner with the measured factor | Motion artifacts | P1 | 2 |
| 2.2 Large scenes setting | Motion artifacts | P1 | 2 |
| 2.3 Motion LoD budget (optional) | Motion artifacts | P2 | 2 |
| 2.4 Next-step load note | Guidance | P2 | 2 |

When Batch 2 lands, tick task 2.2 in `docs/AUDIT_PLAN.md` and point it to this file.
