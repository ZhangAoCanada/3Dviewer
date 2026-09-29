# 3Dviewer

A real-time viewer for 3D Gaussian splats, meshes, and point clouds. It runs in the browser on desktop, phones, and iPads, and is set up for [GitHub Pages](https://zhangaocanada.github.io/3Dviewer/).

Phase 1 loads a file and draws it. Streaming and LoD for reconstructions past 1 GB are designed in [ARCHITECTURE.md](ARCHITECTURE.md) and partially wired through [Spark](https://sparkjs.dev/): worker depth sorting, worker LoD above 400k splats, streamed reads for large files, and paged `.rad` loading.

## Use it

Open the site, or run it locally and visit `http://localhost:5173/3Dviewer/`.

- Drop a file, use **Open**, or pick a **Sample**. The torus splat loads on startup.
- `?url=https://example.com/scene.ply` loads a remote file (the host must allow CORS).
- `?sample=cloud` loads a bundled sample by id (`torus-ply`, `torus-splat`, `cloud`, `crate`, `sphere`, `butterfly`).

| Input | What happens |
| --- | --- |
| `.ply` with `f_dc_*` / `scale_*` / chunked gaussian data | 3D Gaussian splats |
| `.splat`, `.spz`, `.ksplat`, `.sog`, `.zip` (SOG), `.rad` | Gaussian splats. `.rad` is paged. |
| `.ply` with positions (and optional color) | Point cloud. Very large files are subsampled in a worker. |
| `.glb`, `.gltf`, `.obj` | Triangle mesh |

Orbit is the default. **Fly** is a first-person mode. Double-click a point to focus it. **R** frames the scene, **F** focuses the view center, **1** / **2** switch orbit and fly, **H** toggles the side panel.

| Action | Orbit | Fly |
| --- | --- | --- |
| Look | Left drag, one finger | Drag, one finger |
| Pan | Right drag, two-finger drag | — |
| Zoom | Wheel, pinch | Wheel |
| Move | — | WASD, Q/E, Space, Shift to sprint. Two-finger drag moves forward. |

The side panel has scene info, splat size, spherical-harmonics degree, point size, LoD detail, shading, wireframe, 2D Gaussian axes, sort mode, and an FPS / memory readout. **Flip Y** turns OpenCV / COLMAP scenes right-side up. The butterfly sample enables it.

## Develop

Node 20 or newer.

```bash
npm install
npm run dev
```

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run preview   # http://localhost:4173/3Dviewer/
```

`npm run generate:assets` rebuilds the small files in `public/samples/` and the PWA icons. The app is an installable PWA (`manifest.webmanifest`, service worker).

Production `base` is `/3Dviewer/` so asset URLs match GitHub Pages.

## Deploy

`.github/workflows/ci.yml` lints, typechecks, tests, and builds on pull requests and on `main`.

`.github/workflows/pages.yml` builds `dist/` and deploys it with `actions/configure-pages` (`enablement: true`) and `actions/deploy-pages` on every push to `main`. The repository token needs permission to turn Pages on. If that step fails, enable Pages in the repo settings with **GitHub Actions** as the source, then re-run the workflow.

## Layout

Loaders and renderables are separate. A new format is a `FormatLoader` plus a `Renderable`, registered in `src/loaders/index.ts`. See [ARCHITECTURE.md](ARCHITECTURE.md) for the contracts and the parallel workstreams:

1. Large-scale 3DGS streaming and LoD
2. Mesh and voxel formats
3. Point clouds and octrees
4. Mobile and touch UX
5. Native packaging (Tauri / Capacitor)
6. WebGPU backend

## Benchmark

See [BENCHMARK.md](BENCHMARK.md).

## Credits

Rendering uses [Three.js](https://threejs.org/) (MIT) and [Spark](https://github.com/sparkjs-dev/spark) (MIT). The butterfly sample is loaded from `https://sparkjs.dev/assets/splats/butterfly.spz` and is not vendored in this repo.
