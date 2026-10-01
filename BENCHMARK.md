# Benchmark

Measured on 1 Oct 2026 from the production build (`npm run build && npm run preview`) at `http://127.0.0.1:4173/3Dviewer/`.

Browser: headless Chrome, WebGL2 via SwiftShader (software), viewport 1400×900. These FPS numbers are not a discrete-GPU result. The performance panel reported the backend as **WebGL2 (WebGPU present)**.

HUD values are copied from the page after the loading overlay cleared and the counters had settled. Load time is the scene panel's **Load** row.

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

`cloud.ply` is the largest file exercised here (352 KB). A scene past 1 GB was not available, so streaming and LoD for that size are implemented but not timed. On this software GL, orbit drag, fly-mode `W`, and a one-finger touch drag each changed the rendered frame. No page errors were reported.
