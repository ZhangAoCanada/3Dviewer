# Architecture

Phase 1 is a web-first viewer. One TypeScript codebase targets desktop browsers, phones, and iPads. Tauri and Capacitor are packaging steps, not separate renderers.

## Decision

| Choice | Why |
| --- | --- |
| Vite + TypeScript | Fast dev loop, static GitHub Pages output, workers as modules. |
| Three.js r180 scene graph | Cameras, meshes, points, controls, and glTF/OBJ already work everywhere. |
| [@sparkjsdev/spark](https://sparkjs.dev/) 2.x for splats | Loads `.ply` (INRIA and compressed), `.splat`, `.ksplat`, `.spz`, `.sog`, and `.rad`. Depth is evaluated on the GPU and radix-sorted in a WASM worker, off the main thread. LoD trees and paged `.rad` streaming are the practical way to view scenes past 1 GB. |
| WebGL2 now, WebGPU later | Spark's sort, LoD, and pager are WebGL2, which still covers iOS and iPad. `navigator.gpu` is reported in the performance panel. A WebGPU mesh/point backend can replace `SceneHost`'s renderer without changing loaders. |
| No full-engine lock-in | PlayCanvas has excellent streamed SOG, but adopting it would force meshes and point clouds onto that engine. GaussianSplats3D sorts on the CPU and struggles with large scenes. Spark stays behind `GaussianRenderable`, so it can be swapped. |

Rejected for the core, still useful later:

- **Potree / loaders.gl** for LAS/LAZ and octree point clouds. The point-cloud loader already decimates in a worker; an octree streamer should implement `ChunkStreamer`.
- **A custom WebGPU splat renderer** before the paging format exists. Writing another sorter would not load a 1 GB scene.

## Runtime shape

```text
index.html
  ViewerApp
    LoaderRegistry ── FormatLoader.load() ── Renderable
    SceneHost
      WebGLRenderer + SparkRenderer
      NavigationController (orbit | fly)
      content group (zero or more Renderables)
```

`ViewerApp` is the only place that knows about both the DOM and the registry. Format work should not need to edit it except to register a loader in `src/loaders/index.ts`.

## Modules

| Path | Responsibility |
| --- | --- |
| `src/core/types.ts` | `AssetSource`, `FormatLoader`, `Renderable`, `RenderSettings`, `MemoryBudget` |
| `src/core/registry.ts` | Register and resolve loaders. First `sniff() === true` wins, highest `priority` first. |
| `src/core/sniff.ts` | Extension + PLY header classification. Gaussian PLY (`f_dc_*`, `scale_*`, `element chunk`) vs xyz point clouds. |
| `src/core/memoryBudget.ts` | Mobile vs desktop caps: point decimation, resident splat hint, SH degree, pixel ratio. |
| `src/core/samples.ts` | Built-in sample catalog. |
| `src/loaders/gaussian/` | 3DGS / 2DGS via Spark. Owns splat formats. |
| `src/loaders/points/` | Generic PLY point clouds. Parsing lives in `parsePly.ts` and runs in a worker. |
| `src/loaders/mesh/` | glTF/GLB and OBJ. |
| `src/renderables/` | GPU objects. They do not parse files. |
| `src/render/SceneHost.ts` | Three.js + Spark, framing, raycast focus, stats. |
| `src/render/Navigation.ts` | Orbit, fly, keyboard, touch. |
| `src/streaming/types.ts` | `ChunkStreamer` for RAD, streamed SOG, and Potree. Not implemented in Phase 1. |
| `src/ui/`, `src/styles.css` | Shell. No framework. |
| `public/samples/` | Tiny generated assets so the Pages deploy renders without a network fetch. |

## Interfaces other agents implement

### FormatLoader

```ts
interface FormatLoader {
  id: string;
  label: string;
  extensions: readonly string[];
  kind: 'splats' | 'mesh' | 'points' | 'voxels';
  priority: number;
  sniff(source: AssetSource, header: Uint8Array): boolean | undefined;
  load(source: AssetSource, ctx: LoadContext): Promise<Renderable>;
}
```

- Return `true` to claim a file, `false` to reject it, `undefined` to abstain.
- `.ply` is shared. Gaussian and point-cloud sniffers must stay mutually exclusive. Do not claim `.ply` by extension alone.
- `LoadContext.budget` is a soft cap. Stream or decimate. Do not buffer a multi-GB file into one `ArrayBuffer` on the main thread.
- `LoadContext.signal` should abort fetches. The app also drops stale results when a newer file is opened.

### Renderable

```ts
interface Renderable {
  id: string;
  kind: RepresentationKind;
  name: string;
  object: THREE.Object3D;
  meta: RenderableMeta;
  update(dt: number): void;
  applySettings(settings: RenderSettings): void;
  getStats(): RenderableStats;
  getBounds(): THREE.Box3 | null;
  dispose(): void;
}
```

Add `object` to the scene graph. Spark discovers `SplatMesh` children by itself; the host already owns the `SparkRenderer`. Dispose geometries, materials, and splat buffers.

`RenderSettings` already includes splat size, SH degree, point size, shading, wireframe, 2DGS mode, radial sort, LoD detail, grid, Y flip, pixel ratio, and extended precision. Wire new formats into these instead of adding one-off panels when the control already exists.

### ChunkStreamer

Large-scene agents implement `ChunkStreamer` in `src/streaming/` (`rad-paged`, `streamed-sog`, `potree-octree`). The interface is open / prefetch / evict / dispose, with an AABB tree and per-chunk LoD. `UnimplementedStreamer` is the placeholder.

## Large-scene strategy

Phase 1 behavior, in order:

1. **Do not read everything up front.** Gaussian files at or above 16 MB are passed to Spark as a `ReadableStream` (`File.stream()`), not a single byte array. `.rad` sets `paged: true` so Spark's `SplatPager` fetches chunks into a fixed GPU pool.
2. **LoD in a worker.** Every gaussian load sets `lod: true` and `lodAbove: 400_000`. Smaller files render directly. Larger files build a tiny-LoD tree off the main thread. The render panel's LoD detail slider maps to `lodSplatScale`, and the resident budget comes from `MemoryBudget` (about 0.9 M splats on phones, 2.5 M on desktop).
3. **Sort off the main thread.** Spark writes view-space depth with the GPU, then `sort32_splats` runs in a WASM worker. Full GPU radix sort is a later optimization, not a blocker.
4. **Compressed in-memory splats.** The default path is Spark's packed encoding (quantized). Files at or above 80 MB, or the "extended precision" checkbox, use float32 centers so drone-scale coordinates do not stripe.
5. **Point clouds.** The worker reads the PLY in chunks and keeps at most `budget.maxPoints` vertices (1.5 M mobile / 8 M desktop). This is a stand-in until an octree streamer exists. The scene panel shows the stride when a cloud was subsampled.
6. **Pixel ratio.** Capped at 1.5 on mobile and 2 on desktop so fill rate stays interactive.
7. **Main thread.** Parsing of point clouds is in `plyPoints.worker.ts`. Mesh loaders still use Three.js on the main thread; a mesh worker is only worth it if OBJ/STL profiling shows stalls.

What Phase 1 does **not** do: turn an arbitrary 1 GB `.ply` into a paged world by itself. Spark can decode a stream and build LoD up to a few tens of millions of splats, but the durable format for drone reconstructions is a prebuilt chunked `.rad` (or streamed SOG) served with HTTP range requests. That bake step is workstream 1.

## Navigation

- **Orbit** (default): left drag or one finger rotates, right drag / two-finger drag pans, wheel or pinch zooms. Arrow keys pan via OrbitControls.
- **Fly**: drag looks, WASD moves, Q/E and Space move vertically, Shift sprints, wheel dollies. Two-finger vertical drag moves forward on touch.
- **Focus**: double-click or `F` raycasts meshes, points, and splats (Spark's WASM raycast). Multi-million splat picks can hitch; they are not per-frame.
- **Reset**: `R` or the Reset button frames the union of renderable bounds.

Y-up is the default. "Flip Y" applies a 180° X rotation for OpenCV / COLMAP gaussian files. The remote butterfly sample turns it on.

## Workstreams

These are independent enough to land as separate PRs. Stay inside the owned paths. Change `src/core/types.ts` only when the shared contract has to grow, and call that out in the PR.

### 1. Large-scale 3DGS streaming and LoD

Owns `src/loaders/gaussian/**` and new files under `src/streaming/` (RAD / SOG).

- Prebuilt chunked `.rad` (`paged: true`) and a documented bake command (`spark`'s `build-lod`, or PlayCanvas streamed SOG if a converter is easier to ship).
- Progressive UI: coarse root first, chunk priority from the camera, eviction against `MemoryBudget`.
- `.spz`, `.ksplat`, `.sog` are already accepted by the same loader; tighten progress, errors, and SH bands.
- 2DGS is enabled with `enable2DGS` (zero scale axes). Add a real 2DGS sample and screenshots.
- Keep `GaussianRenderable` as the only scene-facing type.

### 2. Mesh and voxel formats

Owns `src/loaders/mesh/**` and `src/renderables/meshRenderable.ts`.

- STL, FBX (only if the Three.js loader stays maintainable), MagicaVoxel `.vox` as a `voxels` kind.
- Do not regress glTF materials, wireframe, or the lit / unlit / normal shading switch.
- Move heavy parses off the main thread if a fixture stalls input.

### 3. Point clouds and octrees

Owns `src/loaders/points/**`, `src/workers/plyPoints.worker.ts`, and `src/renderables/pointCloudRenderable.ts`.

- LAS/LAZ and PCD via the same `FormatLoader` pattern.
- Replace stride decimation with a Potree-style octree that implements `ChunkStreamer`.
- Keep the worker protocol: transferable `Float32Array`s, never a second full copy on the UI thread.

### 4. Mobile and touch UX

Owns `src/ui/**`, `src/styles.css`, and `src/render/Navigation.ts`.

- On-screen fly controls, safer double-tap vs orbit, safe-area insets, memory-pressure DPR.
- Do not fork the loaders. Read `RenderSettings` and `MemoryBudget`.

### 5. Native packaging

Add `src-tauri/` or a Capacitor project in a follow-up. The web build (`base: /3Dviewer/` for Pages, overridable later) is the asset. No second renderer.

### 6. WebGPU backend

Owns `src/render/SceneHost.ts` or a new `src/render/backend.ts` extracted from it.

- Mesh and point paths can move to `WebGPURenderer` when the splat path can share a canvas.
- Until Spark (or a replacement) sorts on WebGPU, splats stay on the WebGL2 context. The panel already reports whether WebGPU exists.

## Conflict rules

- New formats: one folder under `src/loaders/<family>/`, register in `src/loaders/index.ts`.
- Do not parse files inside `SceneHost` or `ViewerApp`.
- Do not import `@sparkjsdev/spark` outside `src/loaders/gaussian/` and `src/renderables/gaussianRenderable.ts` (and `SceneHost`, which owns `SparkRenderer`).
- Samples stay small and generated by `npm run generate:assets`. Do not commit multi-hundred-MB captures; link them from the sample catalog instead.
