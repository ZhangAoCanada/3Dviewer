# Omniview

A real-time viewer for 3D Gaussian splats, meshes, and point clouds. It runs in the browser on desktop, phones, and iPads, and is set up for [GitHub Pages](https://zhangaocanada.github.io/3Dviewer/).

Phase 1 loads a file and draws it. A standard Gaussian `.ply` is decoded in a worker, in chunks, straight into Spark's packed splats, so a multi-gigabyte file is not one `ArrayBuffer` and does not have to fit in the WASM heap. A header `element vertex` count that does not match the body is replaced by the body size when the stride divides it. SH degree drops, then splats are subsampled, when the device budget is too small. Paged `.rad` (Spark `build-lod`) is what to open the next time; that bake is not done in the browser. Details are in [ARCHITECTURE.md](ARCHITECTURE.md).

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

Orbit is the default. Drag orbits the point under the cursor, the wheel zooms toward the cursor, and right-drag (or Shift/Ctrl-drag) pans so that point sticks to the mouse. A flat scan such as a drone scene is treated as Z-up; the Controls panel can force Y-up or Z-up and set look sensitivity. **Fly** is a first-person mode. Double-click a point to fly to it. **R** animates back to the framed view, **F** flies to the view center, **1** / **2** switch orbit and fly, **H** toggles the side panel. `?demo=slab` builds a wide synthetic Z-up cloud for trying the controls.

| Action | Orbit | Fly |
| --- | --- | --- |
| Look | Left drag or one finger, around the point under the cursor | Drag, one finger |
| Pan | Right, middle, or Shift/Ctrl drag. Two fingers pan | — |
| Zoom | Wheel or pinch toward the fingers | Wheel |
| Move | Double-click flies in | WASD, Q/E, Space, Shift to sprint. Two-finger drag moves forward. |

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

`npm run generate:assets` rebuilds the small files in `public/samples/`. `npm run build:icons` rebuilds the favicon, PWA icons, header mark, and Tauri icons from `assets/brand/omniview.svg`. The app is an installable PWA. A new deploy shows a Reload toast; the build id in the About section is the commit (or `VITE_BUILD_LABEL`) baked into that build.

Production `base` is `/3Dviewer/` so asset URLs match GitHub Pages. The desktop build sets `base` to `./` when the Tauri CLI is the one invoking it.

## Desktop app

The same Vite build runs in a [Tauri 2](https://v2.tauri.app/) window. Tauri uses the system WebView: WebView2 on Windows, WKWebView on macOS, and WebKitGTK on Linux. WebGL2, WASM, and the existing module workers run there. There is no second renderer.

```bash
npm run desktop        # tauri dev
npm run desktop:build  # tauri build
```

Open and drag-and-drop stay in the WebView (`dragDropEnabled` is off), so the page receives a `File`. The existing `Blob.slice` path reads a multi-gigabyte PLY in chunks. The shell does not copy the file into a second buffer. The service worker and the Reload toast are disabled inside the app. The GitHub Pages build is unchanged.

### Installers

[`.github/workflows/release.yml`](.github/workflows/release.yml) builds the desktop app when a tag `v*.*.*` is pushed, and when the workflow is run by hand. It uploads unsigned installers to a GitHub Release:

| Platform | Files |
| --- | --- |
| Windows | `.msi` and NSIS `.exe` |
| macOS | universal `.dmg` |
| Linux | `.AppImage` and `.deb` |

The tag should match `package.json` (`v0.2.0` for `0.2.0`). These builds are not code-signed or notarized. The macOS bundle is ad-hoc signed so Gatekeeper does not report it as damaged.

- **Windows:** SmartScreen says the app is unrecognized. Choose **More info**, then **Run anyway**.
- **macOS:** the first open is blocked. **Right-click the app > Open**, then **Open** again.

**Download desktop app** in the top-right island (and in the More menu on a phone) opens a dialog that highlights the installer for this computer and links to https://github.com/ZhangAoCanada/3Dviewer/releases/latest. The button is hidden inside the desktop app. A release is published when a `v0.2.0` tag is pushed.

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
