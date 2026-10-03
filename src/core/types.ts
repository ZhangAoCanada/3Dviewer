import type * as THREE from 'three';

/** What a loaded file becomes in the scene graph. */
export type RepresentationKind = 'splats' | 'mesh' | 'points' | 'voxels';

export type AssetOrigin = 'file' | 'url' | 'sample';

/** A neighbor of the opened model: its `.bin`, `.mtl`, or an image. */
export interface CompanionFile {
  /** `webkitRelativePath`, a drop entry path without the leading slash, or the file name. */
  path: string;
  file: File;
}

/**
 * A file the user picked, dropped, or named by URL.
 * Loaders must not assume the bytes are already in memory.
 */
export interface AssetSource {
  name: string;
  /** Lowercase extension without the dot. Empty when unknown. */
  extension: string;
  origin: AssetOrigin;
  file?: File;
  /** Remote URL or object URL. Prefer `file` for local blobs so parsers can slice. */
  url?: string;
  bytes?: ArrayBuffer;
  sizeBytes?: number;
  /** Other files selected with this one. Includes the primary so its folder is known. */
  companions?: readonly CompanionFile[];
}

export interface LoadProgress {
  loaded: number;
  total?: number;
  stage: 'detect' | 'download' | 'parse' | 'gpu' | 'ready';
  message?: string;
  /**
   * Reading the file, or preparing the scene.
   * Without this, `detect` and `download` are reading, and `parse` and `gpu` are preparing.
   */
  phase?: 'reading' | 'preparing';
  /** Bytes of the file seen so far. `total` is omitted when the length is unknown. */
  bytes?: { loaded: number; total?: number };
}

export interface MemoryBudget {
  profile: 'mobile' | 'desktop';
  /** Soft cap for decoded CPU buffers. */
  cpuBytes: number;
  /** Point-cloud decimation cap used until octree streaming lands. */
  maxPoints: number;
  /** Hint for the splat LOD pager (resident splats). */
  maxSplatsResident: number;
  maxSh: 0 | 1 | 2 | 3;
  pixelRatioCap: number;
}

/** URL measurement overrides. Absent unless `?lod=force` or `?sh=N` was set. */
export interface GaussianLoadOverrides {
  forceLod?: boolean;
  maxSh?: 0 | 1 | 2 | 3;
}

export interface LoadContext {
  signal: AbortSignal;
  onProgress: (progress: LoadProgress) => void;
  budget: MemoryBudget;
  /** When true, gaussian loads request extended (float32 center) encoding. */
  extendedPrecision: boolean;
  /** Read once from the page URL and forwarded to the gaussian decode plan. */
  overrides?: GaussianLoadOverrides;
}

export type ShadingMode = 'lit' | 'flat' | 'normals';

/** Persisted view quality. `auto` is today's device budget with no extra caps. */
export type QualityPreset = 'auto' | 'quality' | 'memory';

export interface RenderSettings {
  quality: QualityPreset;
  splatScale: number;
  shDegree: 0 | 1 | 2 | 3;
  pointSize: number;
  shading: ShadingMode;
  wireframe: boolean;
  enable2DGS: boolean;
  sortRadial: boolean;
  lodSplatScale: number;
  showGrid: boolean;
  flipY: boolean;
  pixelRatio: 'auto' | '1' | '1.5' | '2';
  extendedPrecision: boolean;
}

/** How much of the source file is actually on screen. Absent for Spark-decoded splats. */
export interface SceneDetail {
  sourceCount: number;
  retainedCount: number;
  sourceSh?: number;
  loadedSh?: number;
  /** True when float32 centers were requested and the budget only fit half-float. */
  precisionReduced?: boolean;
}

export interface RenderableStats {
  kind: RepresentationKind;
  label: string;
  primitives: number;
  sourcePrimitives?: number;
  vertices?: number;
  triangles?: number;
  memoryBytes?: number;
  extra?: Record<string, string | number>;
  detail?: SceneDetail;
}

export interface RenderableMeta {
  fileName: string;
  loaderId: string;
  loadMs: number;
  bytes?: number;
}

/**
 * A scene object other agents can render without knowing the file format.
 * `object` is parented by the scene host; implementations own GPU resources.
 */
export interface Renderable {
  readonly id: string;
  readonly kind: RepresentationKind;
  readonly name: string;
  readonly object: THREE.Object3D;
  readonly meta: RenderableMeta;
  update(dt: number): void;
  applySettings(settings: RenderSettings): void;
  getStats(): RenderableStats;
  getBounds(): THREE.Box3 | null;
  dispose(): void;
}

/**
 * Pluggable file-format loader. Register one per format family.
 * Sniff must be mutually exclusive for shared extensions such as `.ply`.
 */
export interface FormatLoader {
  readonly id: string;
  readonly label: string;
  readonly extensions: readonly string[];
  readonly kind: RepresentationKind;
  /** Higher priority wins when two sniffers both claim a file. */
  readonly priority: number;
  /**
   * true = claim the file, false = this loader rejects it,
   * undefined = abstain (another loader may claim it).
   */
  sniff(source: AssetSource, header: Uint8Array): boolean | undefined;
  load(source: AssetSource, ctx: LoadContext): Promise<Renderable>;
}

export const DEFAULT_SETTINGS: RenderSettings = {
  quality: 'auto',
  splatScale: 1,
  shDegree: 3,
  pointSize: 1,
  shading: 'lit',
  wireframe: false,
  enable2DGS: true,
  sortRadial: true,
  lodSplatScale: 1,
  showGrid: false,
  flipY: false,
  pixelRatio: 'auto',
  extendedPrecision: false,
};
