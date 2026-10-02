# Benchmark

Measured on 1 Oct 2026 from the production build (`npm run build && npm run preview`) at `http://127.0.0.1:4173/3Dviewer/`.

Browser: headless Chrome, WebGL2 via SwiftShader (software), viewport 1400×900. These FPS numbers are not a discrete-GPU result. The performance panel reported the backend as **WebGL2 (WebGPU present)**.

HUD values are copied from the page after the loading overlay cleared and the counters had settled. Load time is the scene panel's **Load** row.

Batch 3 changes what those HUD cells mean. FPS counts only frames that called `renderer.render`. When a 0.4 s window draws nothing, the FPS slot reads **idle** instead of a refresh-rate number. The milliseconds figure is an exponential moving average of that render call (`renderMs`), not the time between animation frames. The table above was copied before that change, so its FPS and Frame columns still include skipped frames.

| Sample | How it was opened | Load | FPS | Frame | HUD count | GPU est. |
| --- | --- | --- | --- | --- | --- | --- |
| `torus.ply` (4,800 splats) | startup sample | 47 ms | 34 | 29.1 ms | 4,800 splats | 534 KB |
| `torus.splat` (4,800 splats) | Samples menu | 55 ms | 22 | 45.0 ms | 4,800 splats | 662 KB |
| `cloud.ply` (24,000 points) | Samples menu | 26 ms | 22 | 45.0 ms | 24,000 points | 1011 KB |
| `crate.glb` (12 triangles) | Samples menu | 36 ms | 28 | 36.1 ms | 12 tris | 449 KB |
| `sphere.obj` (1,536 triangles) | Samples menu | 30 ms | 34 | 29.8 ms | 1,536 tris | 556 KB |
| `cloud.ply` again | `?url=` to the same preview origin | 25 ms | 36 | 27.8 ms | 24,000 points | 691 KB |

The point cloud was not subsampled (`stride 1`). Gaussian loads reported packed encoding, LoD off, SH degree 3.

HTTP response sizes for those files, from the preview server (not the HUD): `torus.ply` 326,814 bytes, `torus.splat` 153,600 bytes, `cloud.ply` 360,179 bytes, `crate.glb` 2,204 bytes, `sphere.obj` 89,606 bytes. The scene panel showed **352 KB** for `cloud.ply` and **—** for the gaussian and mesh URL loads in this run.

`cloud.ply` is the largest file exercised in that first run (352 KB). On this software GL, orbit drag, fly-mode `W`, and a one-finger touch drag each changed the rendered frame. No page errors were reported.

## 10,000,000-splat gaussian PLY

Same preview, still headless Chrome on SwiftShader. `navigator.deviceMemory` was **16**, `hardwareConcurrency` was **4**. Viewport for the capture below was 1100×720. The synthetic file is not in git (`tmp/` is ignored).

`tmp/large-gaussian.ply` is **2,480,001,725 bytes**: a 1,725-byte header plus 10,000,000 splats × 248 bytes. Layout matches the owner's file (62 float32s, SH degree 3). The header says `element vertex 17168` on purpose. Comments carry `offsetx 539022.5123`, `offsety 3377206.7481`, `offsetz 22.956`, `epsg 4547`.

The scene panel after the file input, copied from the page:

| Row | Value |
| --- | --- |
| Load | 24,375 ms |
| Size | 2.3 GB |
| Count | 10,000,000 |
| encoding | float32 centers |
| lod | off |
| sh | 3 |
| header | 17,168 |
| body | 10,000,000 |
| epsg | 4547 |
| offset | 539022.5123, 3377206.7481, 22.956 |
| bounds | -24 -6 -24 → 24 8 24 |

The note said the header count was wrong, the body was loaded, and a level-of-detail copy did not fit. No page error was reported.

Decode progress from the loading line, while the torus sample was still on screen (HUD 4,800 splats, about 21–26 fps, GPU est. 480 KB):

| Time after the file input | Detail line |
| --- | --- |
| 2.0 s | 811,800 / 10,000,000 · 8% |
| 8.0 s | 3,247,200 / 10,000,000 · 32% |
| 16.0 s | 6,528,225 / 10,000,000 · 65% |
| 24.1 s | 9,876,900 / 10,000,000 · 99% |

`performance.memory.usedJSHeapSize` after the buffers existed was **1,320,960,521** bytes on one run and **1,319,561,986** bytes on the capture run. The HUD GPU estimate read **1.1 GB**.

A canvas snapshot taken after that allocation has 103,430 pixels that are not the clear color `#10141b`, in a band from about (133, 276) to (791, 557) on the 1100×720 capture. The HUD splat line still read **4,800** at that moment: Spark's `activeSplats` had not moved off the previous sort, so this software renderer did not report a finished sort of all 10,000,000 splats within the 150 s capture wait. FPS for the full set was not measured here. The GPU process stayed above 200% CPU through that wait.

The owner's 14,161,020-splat file was not generated (this VM measured 10,000,000). The plan for that count, from `planGaussianDecode` with `deviceMemory: 8` (same 2.25 GiB CPU cap this Chrome hit at `deviceMemory: 16`), is computed rather than timed: padded allocation 16,777,216, extended SH degree 2 (1,073,741,824 bytes), stride 1, LoD off because a second copy does not fit. A phone profile (`deviceMemory: 4`) is also computed, not browser-tested. After batch 2 that phone plan is extended SH degree 1, stride 21, 674,335 splats, with LoD still decided by the old `estimatedBytes * 2` check. iPad (desktop Macintosh UA with more than one touch point) uses that mobile profile and was not browser-tested.

## Large reload peak (manual)

Opening a second scene at least 64 MB, or any scene while the current one reports at least 256 MB, now drops the previous scene before decode. Unknown file size counts as large. Smaller files still stay on screen until the new one is ready.

Check in Chrome Task Manager: load the 3.5 GB PLY, then load it again. The peak should stay near one scene's footprint. This environment has no 3.5 GB PLY and no Chrome Task Manager, so that peak was not measured here.

## 500,000-splat SH3 decode

`npx vitest bench tests/bench/decode.bench.ts --run`. That file is not part of `npm test`. Synthetic INRIA SH3, 500,000 splats, packed (`preferExtended: false`), desktop budget 2 GiB, one iteration, no warmup. Node v22.14.0.

| Decoder | ms |
| --- | --- |
| Before batch 2 (main `b7f8dd9`, one cold run) | 355 |
| After batch 2 (three cold runs: 478, 476, 519) | 478 median |

The after decode also subtracts the first-chunk origin, derives SH limits, tracks bounds, and reservoir-samples up to 65,536 centers. It does not allocate a `Sample` object per splat. On this file the extra pass and the reservoir dominate that saving.

A later pass keeps that behavior and cuts per-splat overhead: no closure in the float reader, Vitter's Algorithm L for the reservoir (same sample distribution, far fewer random calls once the file exceeds 65,536 splats), and a packed float32 loop that writes scalars straight into the packer. SH limits are still the exact 99th percentile of the first chunk. Same harness, Node on this machine, four fresh processes, interleaved with the batch 2 decoder:

| Decoder | Cold ms (4 runs) | Cold median | Steady ms (3rd call in-process) | Steady median |
| --- | --- | --- | --- | --- |
| Batch 2 (`01336df`) | 476, 470, 485, 554 | 480 | 393, 417, 398, 435 | 407 |
| After the packed-loop pass | 467, 499, 456, 459 | 463 | 376, 371, 369, 364 | 370 |

The cold figure is the one the bench records (`iterations: 1`, no warmup). The steady figure is what a multi-gigabyte file spends most of its time in, after the first chunk has warmed the JIT. Origin, non-finite rejection, bounds, and SH limits are unchanged.

Not measured here: Flip Y long tasks on a 14M scene, a 1 GB `?url=` load on a range-capable host, Chrome Task Manager for the LoD peak, and the stats-panel drop at 8M points. There is no drone PLY in the repo, so `lodCount / count` was not recorded and task 2.2 was skipped.

## Batch 3 frame loop

Mobile Spark options `lodRenderScale: 1.5` and `minSortIntervalMs: 33` are set when the budget profile is `mobile`, and they are not in the UI. This environment has no mid-range Android device or iPhone, and no drone `.rad`, so the plan's "revert unless orbit fps rises by 10%" check was not run. The settings were left as specified.

Not measured here: HUD active-splat ratio at LoD 2.0 vs 1.0, a paged `.rad` sharpening after the pointer is released, the Performance panel while dragging the cutoff slider, slab-demo fps at the new cutoff maximum, and zoom-to-minimum on the slab. The LoD product is covered by `tests/lodParams.test.ts`.

## Owner measurements for the 14,161,020-splat drone scan

These cells are for the owner to fill on the real file, in desktop Chrome. This environment has no drone PLY and no Chrome Task Manager, so the numbers are blank.

1. Open Settings (the panel button) and expand **Performance**. Leave that section open while you orbit. The new **Sort** row is the time between depth-sort starts, in milliseconds. It is a smoothed average. While the view sits still it falls back to **—** after about three seconds with no new sort. While you drag, read the number once it stops jumping. That number is "sort ms while orbiting".
2. Catch-up time is a stopwatch check: flick the view, release, and time how long the splats take to look settled after the ring disappears.
3. LoD splats, when a level-of-detail tree was built, are the **LoD splats** row under **Scene**. The figure in parentheses is `lodCount / count`. **Pick index** in that same section should read **ready** before you record a run.
4. Memory is Chrome Task Manager: the tab plus the GPU process. Note the peak while the file is still loading, then the steady value after the view has settled.
5. Open the viewer with the query string already in the address bar, then choose the drone file (or put the file on a URL and use `?url=`). Do not remove the query before the first load of that run. Record one row per address:

| Run | Decoded SH | LoD | lodCount / count | Peak memory | Steady memory | Orbit fps | Sort ms | Catch-up |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| default (no `lod` or `sh` params) | | | | | | | | |
| `?lod=force&sh=1` | | | | | | | | |
| `?lod=force&sh=0` | | | | | | | | |
| `torus.ply` sample | | | | | | | | |
| `?demo=slab&n=1500000` | | | | | | | | |

For the torus sample and the slab demo, only `lodCount / count` is required. If `?lod=force&sh=1` crashes the tab, write "crashed" in that row. `?sh=2` and `?sh=3` are the same kind of cap if you want an extra row; the three runs above are the ones this batch asks for.
