import { SparkRenderer } from '@sparkjsdev/spark';
import * as THREE from 'three';
import type { MemoryBudget, Renderable, RenderSettings } from '../core/types';
import { NavigationController, type NavMode } from './Navigation';

const DEFAULT_STD_DEV = Math.sqrt(8);

export interface FrameStats {
  fps: number;
  frameMs: number;
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
  private sceneRadius = 2;
  private readonly budget: MemoryBudget;
  webgpuAvailable = false;

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
    this.spark = new SparkRenderer({
      renderer: this.renderer,
      maxStdDev: DEFAULT_STD_DEV,
      enable2DGS: true,
      sortRadial: true,
      enableLod: true,
      lodSplatCount: budget.maxSplatsResident,
      lodSplatScale: 1,
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
    this.navigation = new NavigationController(this.camera, canvas);
    this.resize();
  }

  get items(): readonly Renderable[] {
    return this.renderables;
  }

  setBackground(color: string): void {
    this.renderer.setClearColor(color, 1);
  }

  setMode(mode: NavMode): void {
    this.navigation.setMode(mode);
  }

  clear(): void {
    for (const item of this.renderables) item.dispose();
    this.renderables.length = 0;
    this.content.clear();
  }

  add(renderable: Renderable, settings: RenderSettings): void {
    this.renderables.push(renderable);
    this.content.add(renderable.object);
    renderable.applySettings(settings);
    this.applyEnvironment(settings);
  }

  applySettings(settings: RenderSettings): void {
    this.spark.maxStdDev = DEFAULT_STD_DEV * settings.splatScale;
    this.spark.enable2DGS = settings.enable2DGS;
    this.spark.sortRadial = settings.sortRadial;
    this.spark.lodSplatScale = settings.lodSplatScale;
    this.spark.lodSplatCount = Math.round(this.budget.maxSplatsResident * settings.lodSplatScale);
    for (const item of this.renderables) item.applySettings(settings);
    this.applyEnvironment(settings);
    this.applyPixelRatio(settings);
  }

  setFlip(flip: boolean): void {
    for (const item of this.renderables) {
      if (flip) item.object.quaternion.set(1, 0, 0, 0);
      else item.object.quaternion.identity();
      item.object.updateMatrixWorld(true);
    }
    this.frameAll();
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
    this.sceneRadius = this.navigation.frame(box);
    const size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 0.5);
    this.grid.scale.setScalar(span / 10);
    this.grid.position.y = box.min.y;
  }

  focusPointer(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    this.raycaster.params.Points.threshold = Math.max(this.sceneRadius * 0.01, 0.01);
    const hits = this.raycaster.intersectObjects(this.content.children, true);
    const hit = hits[0];
    if (!hit) return false;
    this.navigation.focusOn(hit.point);
    return true;
  }

  resize(): void {
    const parent = this.canvas.parentElement ?? this.canvas;
    const width = Math.max(1, parent.clientWidth);
    const height = Math.max(1, parent.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  applyPixelRatio(settings: RenderSettings): void {
    const cap = settings.pixelRatio === 'auto' ? this.budget.pixelRatioCap : Number(settings.pixelRatio);
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    this.renderer.setPixelRatio(dpr);
    this.resize();
  }

  start(onFrame: (stats: FrameStats) => void): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.renderer.setAnimationLoop((time) => {
      const dt = Math.min(0.05, (time - this.lastTime) / 1000);
      this.lastTime = time;
      this.navigation.update(dt);
      for (const item of this.renderables) item.update(dt);
      this.renderer.render(this.scene, this.camera);
      this.fpsFrames += 1;
      this.fpsElapsed += dt;
      if (this.fpsElapsed >= 0.4) {
        this.fps = this.fpsFrames / this.fpsElapsed;
        this.frameMs = (this.fpsElapsed / this.fpsFrames) * 1000;
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
      gpuMemoryBytes: this.estimateGpuBytes(),
      backend: 'webgl2',
      webgpuAvailable: this.webgpuAvailable,
      activeSplats: this.spark.activeSplats || 0,
    };
  }

  dispose(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.clear();
    this.navigation.dispose();
    this.renderer.dispose();
  }

  private applyEnvironment(settings: RenderSettings): void {
    this.grid.visible = settings.showGrid;
  }

  private estimateGpuBytes(): number {
    let bytes = 0;
    for (const item of this.renderables) bytes += item.getStats().memoryBytes ?? 0;
    const info = this.renderer.info.memory;
    bytes += info.textures * 1024 * 64;
    return bytes;
  }
}
