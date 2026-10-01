import { SparkRenderer } from '@sparkjsdev/spark';
import * as THREE from 'three';
import type { MemoryBudget, Renderable, RenderSettings } from '../core/types';
import { detectUpAxis } from './cameraMotion';
import { lodParams } from './lodParams';
import { NavigationController, type NavMode, type UpMode } from './Navigation';
import { buildCoarse, collectCoarsePoints, disableSplatRaycast, isSplatObject, pickScene, type SceneHit } from './scenePick';
import type { CoarseSurface } from './coarseSurface';
import { collectIndexSources, SplatIndex, SplatIndexJob } from './splatIndex';

const DEFAULT_STD_DEV = Math.sqrt(8);

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
  private renderEmaReady = false;
  private idle = false;
  upMode: UpMode = 'auto';
  private coarse: CoarseSurface | null = null;
  private index: SplatIndex | null = null;
  private indexJob: SplatIndexJob | null = null;
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
  private readonly pivotMarker = createPivotMarker();
  private readonly budget: MemoryBudget;
  webgpuAvailable = false;
  contextLost = false;
  onContextLost?: () => void;
  onContextRestored?: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    budget: MemoryBudget,
  ) {
    this.budget = budget;
    this.webgpuAvailable = typeof navigator !== 'undefined' && 'gpu' in navigator;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is required. This browser cannot create a WebGL2 context.');
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.onContextRestored?.();
    });
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      context: gl,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x10141b, 1);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.01, 500);
    this.camera.position.set(1.6, 1.1, 2.8);
    const mobile = budget.profile === 'mobile';
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
    this.navigation.pick = (x, y) => this.pick(x, y);
    this.navigation.onPivot = (point) => {
      const visible = point !== null;
      if (this.pivotMarker.visible !== visible) this.viewDirty = true;
      this.pivotMarker.visible = visible;
      if (point) this.pivotMarker.position.copy(point);
    };
    this.resize();
    this.observeResize();
    this.armDprQuery();
  }

  get items(): readonly Renderable[] {
    return this.renderables;
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
    this.index = null;
    this.indexJob = null;
    this.coarse = null;
    this.hasBounds = false;
    this.viewDirty = true;
  }

  add(renderable: Renderable, settings: RenderSettings): void {
    disableSplatRaycast(renderable.object);
    this.renderables.push(renderable);
    this.content.add(renderable.object);
    renderable.applySettings(settings);
    this.applyEnvironment(settings);
    this.viewDirty = true;
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

  setFlip(flip: boolean): void {
    for (const item of this.renderables) {
      if (flip) item.object.quaternion.set(1, 0, 0, 0);
      else item.object.quaternion.identity();
      item.object.updateMatrixWorld(true);
    }
    this.frameAll();
  }

  setUpMode(mode: UpMode): void {
    this.upMode = mode;
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
    this.bounds.copy(box);
    this.hasBounds = true;
    const size = box.getSize(new THREE.Vector3());
    this.navigation.up = this.upMode === 'auto' ? detectUpAxis(size) : this.upMode;
    this.rebuildCoarse();
    this.navigation.frame(box);
    this.placeGrid(box, size);
    this.viewDirty = true;
    this.startIndex(box);
  }

  resetView(): void {
    this.navigation.reset(true);
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
    this.coarse = buildCoarse(collectCoarsePoints(this.content));
  }

  private startIndex(box: THREE.Box3): void {
    this.index = null;
    const sources = collectIndexSources(this.content);
    this.indexJob = sources.length > 0 ? new SplatIndexJob(sources, box) : null;
  }

  private pick(clientX: number, clientY: number): SceneHit | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1,
      -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes: THREE.Object3D[] = [];
    this.content.traverse((object) => {
      if ((object as THREE.Mesh).isMesh && !isSplatObject(object)) meshes.push(object);
    });
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
    return pickScene(
      this.raycaster.ray.origin,
      this.raycaster.ray.direction,
      this.index ? null : this.coarse,
      meshes,
      this.raycaster,
      this.hasBounds ? this.bounds : null,
      this.navigation.pivot,
      indexPoint,
    );
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
      if (this.indexJob) {
        const done = this.indexJob.pump(draw ? 0.35 : 1.4);
        if (done) {
          this.index = this.indexJob.finish();
          this.indexJob = null;
        }
      }
      if (draw) {
        const t0 = performance.now();
        this.renderer.render(this.scene, this.camera);
        const sample = performance.now() - t0;
        this.renderMs = this.renderEmaReady ? this.renderMs + (sample - this.renderMs) * 0.2 : sample;
        this.renderEmaReady = true;
        this.stillPos.copy(this.camera.position);
        this.stillQuat.copy(this.camera.quaternion);
        this.viewDirty = false;
        this.drewOnce = true;
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
    return bytes;
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
