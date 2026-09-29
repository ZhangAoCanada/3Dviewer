# Benchmark

Numbers below are from a local production preview (`npm run build && npm run preview`) in this environment. They are a smoke measurement, not a GPU leaderboard. Re-run on the machine you care about; software WebGL will not represent a discrete GPU.

## How to reproduce

1. `npm run build && npm run preview`
2. Open `http://localhost:4173/3Dviewer/`
3. Wait until the loading overlay clears. Read **FPS**, **Frame**, and **Load** in the panel.
4. Orbit for a few seconds so the worker sort is warm, then read FPS again.
5. Optional larger file: Samples → Butterfly, or `?url=` a scene of your own. For a real >1 GB capture, bake a chunked `.rad` (see ARCHITECTURE.md) and load that URL. A raw multi-GB `.ply` is streamed into Spark and will build LoD only after decode, which is the wrong distribution format.

## This environment

| Sample | Bytes | Primitives | Load | Notes |
| --- | --- | --- | --- | --- |
| `torus.ply` | filled after the browser run | 4,800 splats | | Generated INRIA PLY |
| `torus.splat` | | 4,800 splats | | antimatter15 layout |
| `cloud.ply` | | 24,000 points | | No subsampling at this size |
| `crate.glb` | | 12 triangles | | Vertex colors |
| `sphere.obj` | | lat/long sphere | | |
| Butterfly `.spz` | remote | | | Only if `sparkjs.dev` allows CORS |

The largest file exercised here is the bigger of the bundled samples and the remote butterfly, if that fetch succeeds. A 1 GB scene was not available in the sandbox. The loader path for that size is covered by code (stream above 16 MB, extended precision above 80 MB, LoD above 400k splats, `.rad` paging) and is not claimed as measured.

## What "fast enough" means in Phase 1

- UI stays responsive while a point cloud parses (worker).
- Splat depth sort does not run on the main thread (Spark WASM worker).
- Mobile budgets cap pixel ratio, SH degree, resident splats, and point count.

Fill the table from the HUD after a real browser pass. Do not invent FPS.
