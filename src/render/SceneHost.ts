import { SparkRenderer } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { GraphicsUnavailableError } from '../core/loadFailure';
import type { MemoryBudget, Renderable, RenderSettings } from '../core/types';
import { detectUpAxis, groundPlaneHit, isFlatScene, upVector } from './cameraMotion';
import { lodParams } from './lodParams';
import { NavigationController, type NavMode, type UpMode } from './Navigation';
import { buildCoarse, collectCoarsePoints, disableSplatRaycast, isSplatObject, pickScene, type SceneHit } from './scenePick';
import type { CoarseSurface } from './coarseSurface';
import { SortIntervalTracker } from './sortTimer';
import { collectIndexSources, SplatIndex, SplatIndexJob } from './splatIndex';
import { FLIP_Y, isIdentityOrientation, robustBox, snapOrientation } from './upright';

const DEFAULT_STD_DEV = Math.sqrt(8);
/** Several quick turns rebuild the pick index once, after the user stops. */
const INDEX_AFTER_MS = 600;

/** What is still refining after the loading card closes. */
export interface Refinement {
  pending: boolean;
  /** Pick-index build fraction, or null when no index job is running. */
  index: number | null;
  paging: boolean;
  sorting: boolean;
}

export interface FrameStats {
  fps: number;
  frameMs: number;
  /** Exponential moving average of `renderer.render` time, in milliseconds. */
  renderMs: number;
  /** True when the last sample window drew no frame. */
  idle: boolean;
  gpuMemoryBytes: number;
  backend: 'webgl2';
  webgpuAvailable: boolean;
  activeSplats: number;
  /** Recent sort interval, or null when no sort has started in the last 3 s. */
  sortMs: number | null;
}

/**
 * WebGL2 scene, camera, Spark splat renderer, and navigation.
 * WebGPU is detected and reported. Splats stay on Spark's WebGL2 path because
 * that is the implementation with worker sorting and LOD paging today.
 */
export class SceneHost {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly spark: SparkRenderer;
  readonly navigation: NavigationController;
  readonly content = new THREE.Group();
  readonly grid: THREE.GridHelper;
  private readonly renderables: Renderable[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private running = false;
  private lastTime = 0;
  private fpsFrames = 0;
  private fpsElapsed = 0;
  private frameMs = 0;
  private fps = 0;
  private renderMs = 0;
  /** Last `renderer.render` duration, before the moving average. */
  lastRenderMs = 0;
  /** Frames that called `renderer.render`. Updated next to the first-draw flag. */
  readonly drawStamp = { count: 0, at: 0 };
  private renderEmaReady = false;
  private idle = false;
  upMode: UpMode = 'auto';
  private coarse: CoarseSurface | null = null;
  private index: SplatIndex | null = null;
  private indexJob: SplatIndexJob | null = null;
  /** `lastSortTime` captured when a splat scene was added, before its first sort. */
  private sortMark = 0;
  private awaitingSort = false;
  private readonly bounds = new THREE.Box3();
  private hasBounds = false;
  private viewDirty = true;
  private drewOnce = false;
  private lastMotionTime = Number.NEGATIVE_INFINITY;
  private lastSettings: RenderSettings | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dprQuery: MediaQueryList | null = null;
  private readonly viewSize = new THREE.Vector2();
  private readonly stillPos = new THREE.Vector3();
  private readonly stillQuat = new THREE.Quaternion();
  private readonly pickForward = new THREE.Vector3();
  private readonly pickPoint = new THREE.Vector3();
  private readonly pickNdc = new THREE.Vector2();
  private readonly pickMeshes: THREE.Object3D[] = [];
  private readonly wheelMeshes: THREE.Object3D[] = [];
  private indexStamp = '';
  private flipVersion = 0;
  private readonly identityCenter = new THREE.Vector3();
  private hasIdentityCenter = false;
  private pinnedUp: 'y' | 'z' | null = null;
  private deferIndex = false;
  private indexAfter = 0;
  private pendingIndexBox: THREE.Box3 | null = null;
  private flat = false;
  private groundLevel = 0;
  private readonly sortTimer = new SortIntervalTracker();
  private readonly groundUp = new THREE.Vector3();
  private readonly pivotMarker = createPivotMarker();
  private readonly budget: MemoryBudget;
  webgpuAvailable = false;
  contextLost = false;
  private creationStatus = '';
  onContextLost?: () => void;
  onContextRestored?: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    budget: MemoryBudget,
  ) {
    this.budget = budget;
    this.webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const gl = requireWebGL2(canvas, (status) => {
      this.creationStatus = status;
    });
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        context: gl,
        antialias: false,
        alpha: false,
        powerPreference: 'high-performance',
      });
    } catch (error) {
      throw new GraphicsUnavailableError(
        'renderer-failed',
        'The 3D renderer could not start.',
        this.creationStatus || undefined,
        { cause: error },
      );
    }
    this.renderer = renderer;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x10141b, 1);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 500);
    this.camera.position.set(1.6, 1.1, 2.8);
    const mobile = budget.profile === 'mobile';
    try {
      this.spark = new SparkRenderer({
        renderer: this.renderer,
        maxStdDev: DEFAULT_STD_DEV,
        enable2DGS: true,
        sortRadial: true,
        enableLod: true,
        lodSplatCount: budget.maxSplatsResident,
        lodSplatScale: 1,
        ...(mobile ? { lodRenderScale: 1.5, minSortIntervalMs: 33 } : {}),
      });
    } catch (error) {
      this.renderer.dispose();
      throw new GraphicsUnavailableError(
        'renderer-failed',
        'The splat renderer could not start.',
        this.creationStatus || undefined,
        { cause: error },
      );
    }
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.onContextRestored?.();
    });
    this.scene.add(this.spark);
    this.scene.add(this.content);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.62));
    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(3.5, 5.5, 2.5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x9eb4ff, 0.45);
    fill.position.set(-4, 1.5, -2);
    this.scene.add(fill);
    this.grid = new THREE.GridHelper(10, 20, 0x3d4c63, 0x2a3546);
    this.grid.visible = false;
    this.scene.add(this.grid);
    this.scene.add(this.pivotMarker);
    this.navigation = new NavigationController(this.camera, canvas);
    this.navigation.pick = (x, y, kind) => this.pick(x, y, kind);
    this.navigation.onPivot = (point, kind) => {
      const visible = point !== null;
      if (this.pivotMarker.visible !== visible) this.viewDirty = true;
      this.pivotMarker.visible = visible;
      if (point) this.pivotMarker.position.copy(point);
      if (kind) {
        paintPivot(this.pivotMarker, kind === 'surface' ? 0x7ee0c6 : 0xf2b45a);
        this.viewDirty = true;
      }
    };
    this.resize();
    this.observeResize();
    this.armDprQuery();
  }

  get items(): readonly Renderable[] {
    return this.renderables;
  }

  get contextStatusMessage(): string {
    return this.creationStatus;
  }

  get rendererInfo(): { renderer?: string; vendor?: string; maxTextureSize: number; software: boolean } {
    const gl = this.renderer.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    let renderer: string | undefined;
    let vendor: string | undefined;
    if (debug) {
      const rawRenderer = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);
      const rawVendor = gl.getParameter(debug.UNMASKED_VENDOR_WEBGL);
      if (typeof rawRenderer === 'string') renderer = rawRenderer;
      if (typeof rawVendor === 'string') vendor = rawVendor;
    }
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const software = renderer != null && /SwiftShader|llvmpipe|Software|Basic Render/i.test(renderer);
    return { renderer, vendor, maxTextureSize: typeof max === 'number' ? max : 0, software };
  }

  setBackground(color: string): void {
    this.renderer.setClearColor(color, 1);
    this.viewDirty = true;
  }

  setMode(mode: NavMode): void {
    this.navigation.setMode(mode);
  }

  clear(): void {
    for (const item of this.renderables) item.dispose();
    this.renderables.length = 0;
    this.content.clear();
    this.content.quaternion.identity();
    this.content.position.set(0, 0, 0);
    this.content.updateMatrixWorld(true);
    this.hasIdentityCenter = false;
    this.pinnedUp = null;
    this.deferIndex = false;
    this.indexAfter = 0;
    this.pendingIndexBox = null;
    this.index = null;
    this.indexJob = null;
    this.indexStamp = '';
    this.awaitingSort = false;
    this.sortMark = 0;
    this.coarse = null;
    this.flat = false;
    this.groundLevel = 0;
    this.sortTimer.reset();
    this.hasBounds = false;
    this.viewDirty = true;
    this.rebuildPickMeshes();
  }

  add(renderable: Renderable, settings: RenderSettings): void {
    disableSplatRaycast(renderable.object);
    this.renderables.push(renderable);
    this.content.add(renderable.object);
    renderable.applySettings(settings);
    this.applyEnvironment(settings);
    this.rebuildPickMeshes();
    this.viewDirty = true;
    if (renderable.kind === 'splats') this.armSortWatch();
  }

  /**
   * Pick index, LOD paging, and the first Spark sort after `add`.
   * Meshes and clouds that finish before the next stats sample report nothing pending.
   */
  refinement(): Refinement {
    const index = this.indexJob ? this.indexJob.progress : null;
    const paging = this.pagerPending();
    const sorting = this.sortingPending();
    return { pending: index != null || paging || sorting, index, paging, sorting };
  }

  private armSortWatch(): void {
    const spark = this.spark as unknown as { lastSortTime?: number };
    this.sortMark = spark.lastSortTime ?? 0;
    this.awaitingSort = true;
  }

  /** Spark's sort flag and the timestamp of the sort that most recently started. */
  sortState(): { sorting?: boolean; lastSortTime?: number } {
    const spark = this.spark as unknown as { lastSortTime?: number; sorting?: boolean };
    return { sorting: spark.sorting, lastSortTime: spark.lastSortTime };
  }

  /** True until the first sort after `add` finishes. A missing `sorting` field means not sorting. */
  private sortingPending(): boolean {
    if (!this.awaitingSort) return false;
    const spark = this.spark as unknown as { lastSortTime?: number; sorting?: boolean };
    if (typeof spark.sorting !== 'boolean') {
      this.awaitingSort = false;
      return false;
    }
    const changed = spark.lastSortTime !== this.sortMark;
    if (changed && spark.sorting === false) {
      this.awaitingSort = false;
      return false;
    }
    return true;
  }

  applySettings(settings: RenderSettings): void {
    this.lastSettings = settings;
    const lod = lodParams(this.budget, settings);
    this.spark.maxStdDev = DEFAULT_STD_DEV * settings.splatScale;
    this.spark.enable2DGS = settings.enable2DGS;
    this.spark.sortRadial = settings.sortRadial;
    this.spark.lodSplatScale = lod.lodSplatScale;
    this.spark.lodSplatCount = lod.lodSplatCount;
    for (const item of this.renderables) item.applySettings(settings);
    this.applyEnvironment(settings);
    this.applyPixelRatio(settings);
    this.viewDirty = true;
  }

  /** World rotation of the content group, relative to the file axes. */
  get orientation(): THREE.Quaternion {
    return this.content.quaternion.clone();
  }

  /**
   * Rotate the whole scene about its unrotated bounds center.
   * `up` is pinned while the rotation is not the identity, so a leveled scan
   * keeps the axis the user was using instead of re-detecting a tilted box.
   */
  setOrientation(q: THREE.Quaternion, up: UpMode): void {
    if (!this.hasIdentityCenter) this.captureIdentityCenter();
    const snapped = snapOrientation(q);
    const rotated = this.identityCenter.clone().applyQuaternion(snapped);
    this.content.quaternion.copy(snapped);
    this.content.position.copy(this.identityCenter).sub(rotated);
    this.content.updateMatrixWorld(true);
    this.pinnedUp = !isIdentityOrientation(snapped) && (up === 'y' || up === 'z') ? up : null;
    this.flipVersion += 1;
    this.deferIndex = true;
    this.frameAll();
    this.deferIndex = false;
    this.viewDirty = true;
  }

  setFlip(flip: boolean): void {
    this.setOrientation(flip ? FLIP_Y.clone() : new THREE.Quaternion(), this.upMode);
  }

  setUpMode(mode: UpMode): void {
    this.upMode = mode;
    if (!isIdentityOrientation(this.content.quaternion)) this.pinnedUp = mode === 'y' || mode === 'z' ? mode : null;
    this.frameAll();
  }

  setSensitivity(value: number): void {
    this.navigation.setSensitivity(value);
  }

  get upAxis(): 'y' | 'z' {
    return this.navigation.up;
  }

  frameAll(): void {
    const box = new THREE.Box3();
    let any = false;
    for (const item of this.renderables) {
      const bounds = item.getBounds();
      if (!bounds || bounds.isEmpty()) continue;
      box.union(bounds);
      any = true;
    }
    if (!any) return;
    const oriented = !isIdentityOrientation(this.content.quaternion);
    let measured = box;
    if (oriented) {
      const points = collectCoarsePoints(this.content);
      if (points) {
        const robust = robustBox(points);
        if (!robust.isEmpty()) measured = robust;
      }
    }
    this.bounds.copy(measured);
    this.hasBounds = true;
    const size = measured.getSize(new THREE.Vector3());
    if (oriented && this.pinnedUp) this.navigation.up = this.pinnedUp;
    else this.navigation.up = this.upMode === 'auto' ? detectUpAxis(size) : this.upMode;
    this.flat = isFlatScene(size, this.navigation.up);
    this.rebuildCoarse();
    this.navigation.frame(measured, this.flat ? this.groundLevel : undefined);
    this.placeGrid(measured, size);
    this.viewDirty = true;
    const stamp = this.indexKey();
    if (stamp === this.indexStamp && (this.index || this.indexJob || this.indexAfter > 0)) return;
    this.indexStamp = stamp;
    if (this.deferIndex) {
      this.index = null;
      this.indexJob = null;
      this.indexAfter = performance.now() + INDEX_AFTER_MS;
      this.pendingIndexBox = box.clone();
      return;
    }
    this.indexAfter = 0;
    this.pendingIndexBox = null;
    this.startIndex(box);
  }

  resetView(): void {
    this.navigation.reset(true);
  }

  /** About 25 surface hits on a 5×5 grid inside a 32 px window. Points are copied. */
  sampleGround(clientX: number, clientY: number): Float32Array {
    const coords: number[] = [];
    const step = 32 / 4;
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 5; col += 1) {
        const hit = this.pick(clientX + (col - 2) * step, clientY + (row - 2) * step);
        if (hit?.kind !== 'surface') continue;
        coords.push(hit.point.x, hit.point.y, hit.point.z);
      }
    }
    return Float32Array.from(coords);
  }

  focusPointer(clientX: number, clientY: number): boolean {
    const hit = this.pick(clientX, clientY);
    if (!hit) return false;
    this.navigation.focusOn(hit.point);
    return true;
  }

  private placeGrid(box: THREE.Box3, size: THREE.Vector3): void {
    const center = box.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 0.5);
    this.grid.scale.setScalar(span / 10);
    if (this.navigation.up === 'z') {
      this.grid.rotation.set(Math.PI / 2, 0, 0);
      this.grid.position.set(center.x, center.y, box.min.z);
      return;
    }
    this.grid.rotation.set(0, 0, 0);
    this.grid.position.set(center.x, box.min.y, center.z);
  }

  private rebuildCoarse(): void {
    const points = collectCoarsePoints(this.content);
    this.coarse = buildCoarse(points);
    if (points && points.length >= 3) this.groundLevel = medianComponent(points, this.navigation.up === 'z' ? 2 : 1);
  }

  /** "ready", "building 43%", or "" when this scene has no pick index. */
  pickIndexLabel(): string {
    if (this.index) return 'ready';
    if (this.indexJob) return `building ${Math.min(99, Math.round(this.indexJob.progress * 100))}%`;
    return '';
  }

  private startIndex(box: THREE.Box3): void {
    this.index = null;
    const sources = collectIndexSources(this.content);
    this.indexJob = sources.length > 0 ? new SplatIndexJob(sources, box) : null;
  }

  private pick(clientX: number, clientY: number, kind?: 'wheel'): SceneHit | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pickNdc.set(
      ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
      -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pickNdc, this.camera);
    const meshes = kind === 'wheel' ? this.wheelPickMeshes() : this.pickMeshes;
    let indexPoint: THREE.Vector3 | null = null;
    if (this.index) {
      this.camera.getWorldDirection(this.pickForward);
      const height = Math.max(this.canvas.clientHeight, 1);
      if (
        this.index.pick(
          this.raycaster.ray.origin,
          this.raycaster.ray.direction,
          this.pickForward,
          THREE.MathUtils.degToRad(this.camera.fov),
          height,
          this.pickPoint,
        )
      ) {
        indexPoint = this.pickPoint;
      }
    }
    const origin = this.raycaster.ray.origin;
    const direction = this.raycaster.ray.direction;
    const surfaceHit = pickScene(
      origin,
      direction,
      this.index ? null : this.coarse,
      meshes,
      this.raycaster,
      null,
      this.navigation.pivot,
      indexPoint,
    );
    if (surfaceHit?.kind === 'surface') return surfaceHit;
    if (this.flat) {
      const ground = groundPlaneHit(
        origin,
        direction,
        upVector(this.navigation.up, this.groundUp),
        this.groundLevel,
        4 * Math.max(this.navigation.sceneRadius, 0.05),
      );
      if (ground) return { point: ground, surface: false, kind: 'ground' };
      return surfaceHit ? { point: surfaceHit.point, surface: false, kind: 'none' } : null;
    }
    const miss = pickScene(origin, direction, null, [], this.raycaster, this.hasBounds ? this.bounds : null, this.navigation.pivot, null);
    if (!miss) return null;
    return { point: miss.point, surface: false, kind: 'none' };
  }

  resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const dpr = this.renderer.getPixelRatio();
    this.renderer.getSize(this.viewSize);
    const bufferWidth = Math.floor(width * dpr);
    const bufferHeight = Math.floor(height * dpr);
    const sizeChanged = this.viewSize.x !== width || this.viewSize.y !== height;
    const bufferChanged = this.canvas.width !== bufferWidth || this.canvas.height !== bufferHeight;
    if (sizeChanged || bufferChanged) this.renderer.setSize(width, height, false);
    this.viewDirty = true;
  }

  applyPixelRatio(settings: RenderSettings): void {
    this.lastSettings = settings;
    const cap = settings.pixelRatio === 'auto' ? this.budget.pixelRatioCap : Number(settings.pixelRatio);
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    if (dpr === this.renderer.getPixelRatio()) return;
    this.renderer.setPixelRatio(dpr);
    this.resize();
  }

  start(onFrame: (stats: FrameStats) => void): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop((time) => {
      if (this.contextLost) return;
      const elapsed = Math.max(0, (time - this.lastTime) / 1000);
      this.lastTime = time;
      const dt = Math.min(0.05, elapsed);
      this.navigation.update(dt);
      this.updatePivotMarker();
      this.updateNearPlane();
      for (const item of this.renderables) item.update(dt);
      const draw = this.needsDraw();
      this.sortTimer.sample((this.spark as unknown as { lastSortTime?: number }).lastSortTime, time);
      if (this.indexAfter > 0 && this.pendingIndexBox && time >= this.indexAfter) {
        this.indexAfter = 0;
        const pending = this.pendingIndexBox;
        this.pendingIndexBox = null;
        this.startIndex(pending);
      }
      if (this.indexJob) {
        const done = this.indexJob.pump(draw ? 2 : 6);
        if (done) {
          this.index = this.indexJob.finish();
          this.indexJob = null;
        }
      }
      if (draw) {
        const t0 = performance.now();
        this.renderer.render(this.scene, this.camera);
        const sample = performance.now() - t0;
        this.lastRenderMs = sample;
        this.renderMs = this.renderEmaReady ? this.renderMs + (sample - this.renderMs) * 0.2 : sample;
        this.renderEmaReady = true;
        this.stillPos.copy(this.camera.position);
        this.stillQuat.copy(this.camera.quaternion);
        this.viewDirty = false;
        this.drewOnce = true;
        this.drawStamp.count += 1;
        this.drawStamp.at = performance.now();
        this.fpsFrames += 1;
      }
      this.fpsElapsed += elapsed;
      if (this.fpsElapsed >= 0.4) {
        this.idle = this.fpsFrames === 0;
        if (this.fpsFrames > 0) {
          this.fps = this.fpsFrames / this.fpsElapsed;
          this.frameMs = (this.fpsElapsed / this.fpsFrames) * 1000;
        } else {
          this.fps = 0;
          this.frameMs = 0;
        }
        this.fpsFrames = 0;
        this.fpsElapsed = 0;
        onFrame(this.stats());
      }
    });
  }

  /** Live WebGL object counts. Only read while the performance panel is open. */
  gpuObjects(): { geometries: number; textures: number } {
    const memory = this.renderer.info.memory;
    return { geometries: memory.geometries, textures: memory.textures };
  }

  stats(): FrameStats {
    return {
      fps: this.fps,
      frameMs: this.frameMs,
      renderMs: this.renderMs,
      idle: this.idle,
      gpuMemoryBytes: this.estimateGpuBytes(),
      backend: 'webgl2',
      webgpuAvailable: this.webgpuAvailable,
      activeSplats: this.spark.activeSplats || 0,
      sortMs: this.sortTimer.ms,
    };
  }

  dispose(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    this.dprQuery = null;
    this.clear();
    disposeMeshResources(this.pivotMarker);
    this.grid.geometry.dispose();
    const gridMaterials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    for (const material of gridMaterials) material.dispose();
    this.spark.dispose();
    this.navigation.dispose();
    this.renderer.dispose();
  }

  private applyEnvironment(settings: RenderSettings): void {
    this.grid.visible = settings.showGrid;
  }

  private updatePivotMarker(): void {
    if (!this.pivotMarker.visible) return;
    this.pivotMarker.quaternion.copy(this.camera.quaternion);
    const dist = Math.max(this.camera.position.distanceTo(this.pivotMarker.position), 1e-3);
    const height = Math.max(this.canvas.clientHeight, 1);
    const world = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * dist * 18) / height;
    this.pivotMarker.scale.setScalar(world);
  }

  private needsDraw(): boolean {
    const moving =
      this.navigation.isMoving() ||
      this.pivotMarker.visible ||
      this.stillPos.distanceToSquared(this.camera.position) > 1e-10 ||
      Math.abs(this.stillQuat.dot(this.camera.quaternion)) < 1 - 1e-8;
    if (moving) this.lastMotionTime = performance.now();
    if (!this.drewOnce || this.viewDirty || this.spark.dirty || this.spark.sortDirty) return true;
    if (moving || performance.now() - this.lastMotionTime < 1000) return true;
    return this.pagerPending();
  }

  private pagerPending(): boolean {
    const pager = (
      this.spark as unknown as {
        pager?: {
          fetchers?: unknown[];
          fetched?: unknown[];
          newUploads?: unknown[];
          readyUploads?: unknown[];
          lodTreeUpdates?: unknown[];
        };
      }
    ).pager;
    if (!pager) return false;
    return Boolean(
      pager.fetchers?.length ||
        pager.fetched?.length ||
        pager.newUploads?.length ||
        pager.readyUploads?.length ||
        pager.lodTreeUpdates?.length,
    );
  }

  private updateNearPlane(): void {
    if (!this.hasBounds || !this.navigation.isMoving()) return;
    const radius = Math.max(this.navigation.sceneRadius, 0.05);
    const distance = this.camera.position.distanceTo(this.navigation.pivot);
    const near = THREE.MathUtils.clamp(distance / 400, radius / 1e5, radius / 800);
    const current = this.camera.near;
    if (current > 0 && Math.abs(near - current) <= current * 0.1) return;
    this.camera.near = near;
    this.camera.updateProjectionMatrix();
  }

  private observeResize(): void {
    const parent = this.canvas.parentElement;
    if (!parent || typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(parent);
  }

  private armDprQuery(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    this.dprQuery?.removeEventListener('change', this.onDprChange);
    const dpr = window.devicePixelRatio || 1;
    this.dprQuery = window.matchMedia(`(resolution: ${dpr}dppx)`);
    this.dprQuery.addEventListener('change', this.onDprChange);
  }

  private onDprChange = (): void => {
    if (this.lastSettings) this.applyPixelRatio(this.lastSettings);
    this.armDprQuery();
  };

  private estimateGpuBytes(): number {
    let bytes = 0;
    for (const item of this.renderables) bytes += item.getStats().memoryBytes ?? 0;
    const info = this.renderer.info.memory;
    bytes += info.textures * 1024 * 64;
    if (this.index) bytes += 4 * this.index.count + 16 * this.index.cells;
    return bytes;
  }

  private rebuildPickMeshes(): void {
    this.pickMeshes.length = 0;
    this.content.traverse((object) => {
      if ((object as THREE.Mesh).isMesh && !isSplatObject(object)) this.pickMeshes.push(object);
    });
  }

  /** Wheel picks skip meshes above 500k triangles; the splat index covers their vertices. */
  private wheelPickMeshes(): THREE.Object3D[] {
    this.wheelMeshes.length = 0;
    for (const mesh of this.pickMeshes) {
      if (triangleCount(mesh) <= 500_000) this.wheelMeshes.push(mesh);
    }
    return this.wheelMeshes;
  }

  private captureIdentityCenter(): void {
    const savedQ = this.content.quaternion.clone();
    const savedP = this.content.position.clone();
    this.content.quaternion.identity();
    this.content.position.set(0, 0, 0);
    this.content.updateMatrixWorld(true);
    try {
      const box = new THREE.Box3();
      let any = false;
      for (const item of this.renderables) {
        const bounds = item.getBounds();
        if (!bounds || bounds.isEmpty()) continue;
        box.union(bounds);
        any = true;
      }
      if (!any) return;
      box.getCenter(this.identityCenter);
      this.hasIdentityCenter = true;
    } finally {
      this.content.quaternion.copy(savedQ);
      this.content.position.copy(savedP);
      this.content.updateMatrixWorld(true);
    }
  }

  private indexKey(): string {
    let key = `${this.flipVersion}:`;
    for (const item of this.renderables) {
      item.object.updateMatrixWorld();
      key += `${item.object.id}:`;
      const elements = item.object.matrixWorld.elements;
      for (let i = 0; i < 16; i += 1) key += `${elements[i]},`;
      key += ';';
    }
    return key;
  }
}

function requireWebGL2(canvas: HTMLCanvasElement, onStatus: (status: string) => void): WebGL2RenderingContext {
  let status = '';
  const onFail = (event: Event) => {
    const message = (event as WebGLContextEvent).statusMessage;
    if (message) status = message;
  };
  canvas.addEventListener('webglcontextcreationerror', onFail);
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
  } finally {
    canvas.removeEventListener('webglcontextcreationerror', onFail);
  }
  if (status) onStatus(status);
  if (!gl) {
    throw new GraphicsUnavailableError(
      'no-webgl2',
      'WebGL2 is required. This browser cannot create a WebGL2 context.',
      status || undefined,
    );
  }
  return gl;
}

function disposeMeshResources(object: THREE.Object3D): void {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) material.dispose();
  });
}

function triangleCount(object: THREE.Object3D): number {
  const geometry = (object as THREE.Mesh).geometry;
  if (!geometry) return 0;
  if (geometry.index) return geometry.index.count / 3;
  const position = geometry.getAttribute('position');
  return position ? position.count / 3 : 0;
}

function medianComponent(points: Float32Array, axis: number): number {
  const values: number[] = [];
  for (let i = axis; i < points.length; i += 3) values.push(points[i] ?? 0);
  values.sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  if (values.length % 2 === 0) return ((values[mid - 1] ?? 0) + (values[mid] ?? 0)) / 2;
  return values[mid] ?? 0;
}

function paintPivot(group: THREE.Group, color: number): void {
  for (const child of group.children) {
    const material = (child as THREE.Mesh).material;
    if (material instanceof THREE.MeshBasicMaterial) material.color.setHex(color);
  }
}

function createPivotMarker(): THREE.Group {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.72, 1, 48),
    new THREE.MeshBasicMaterial({
      color: 0x7ee0c6,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.14, 20),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.frustumCulled = false;
  dot.frustumCulled = false;
  ring.renderOrder = 20;
  dot.renderOrder = 21;
  group.add(ring, dot);
  group.visible = false;
  group.frustumCulled = false;
  return group;
}
