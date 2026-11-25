import * as THREE from 'three';
import type { Renderable } from '../core/types';
import type { NavigationController } from '../render/Navigation';
import { fitPlane } from '../render/upright';
import { gameFrame, playerScale, toWorld, type GameFrame } from './frame';
import { Walker, type WalkWorld } from './locomotion';
import { collisionInFrame, footprintInFrame, prepareSceneGeometry, type SceneGeometry } from './sceneGeometry';
import { captureGameView, restoreGameView, type GameViewSnapshot } from './viewSnapshot';
export interface GroundSuggestion {
  normal: THREE.Vector3;
  point: THREE.Vector3;
  evidence: string;
}
/** Detector integration port. Proposals are never auto-accepted or treated as collision support. */
export interface GroundAnalysis { suggestions: GroundSuggestion[]; message: string }
export type GroundSuggestions = (geometry: SceneGeometry, up: THREE.Vector3, signal: AbortSignal) => Promise<GroundAnalysis>;
export interface GameConfig {
  geometry: SceneGeometry;
  saved: GameViewSnapshot;
  normal: THREE.Vector3;
  point: THREE.Vector3;
  eyeHeight: number;
  support: 'mesh' | 'virtual';
  confirmed: boolean;
  evidence: string;
  suggestions: GroundSuggestion[];
}
interface Run {
  config: GameConfig;
  walker: Walker;
  frame: GameFrame;
}
export type GameState = {
  kind: 'inactive';
} | {
  kind: 'preparing';
  saved: GameViewSnapshot;
  abort: AbortController;
} | {
  kind: 'setup';
  config: GameConfig;
  message: string;
} | {
  kind: 'acquiring';
  run: Run;
} | {
  kind: 'playing';
  run: Run;
  control: 'locked' | 'keyboard';
} | {
  kind: 'paused';
  run: Run;
  message: string;
};
export interface GameHost {
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  navigation: NavigationController;
  scene: THREE.Scene;
  items: () => readonly Renderable[];
  up: () => 'y' | 'z';
  sampleGround: (x: number, y: number) => Float32Array;
  dirty: () => void;
}
export class GameSession {
  state: GameState = { kind: 'inactive' };
  suggestions: GroundSuggestions | null = null;
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  private readonly keys = new Set<string>();
  private readonly preview = new THREE.Group();
  private picking = false;
  private yaw = 0;
  private pitch = 0;
  private readonly look = new THREE.Quaternion();
  constructor(private readonly host: GameHost) {
    host.scene.add(this.preview);
    document.addEventListener('pointerlockchange', this.onLock);
    document.addEventListener('pointerlockerror', this.onLockError);
    document.addEventListener('mousemove', this.onMouse);
    document.addEventListener('focusin', this.onFocus);
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    host.canvas.addEventListener('pointerdown', this.onPick, true);
  }
  get active(): boolean { return this.state.kind !== 'inactive'; }
  get playing(): boolean { return this.state.kind === 'playing'; }
  get ownsCamera(): boolean { return this.state.kind === 'playing' || this.state.kind === 'paused' || this.state.kind === 'acquiring'; }
  get config(): GameConfig | null {
    const state = this.state;
    return state.kind === 'setup' ? state.config : state.kind === 'playing' || state.kind === 'paused' || state.kind === 'acquiring' ? state.run.config : null;
  }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private changed(): void { this.host.dirty(); for (const listener of this.listeners)
    listener(); }
  async enter(): Promise<void> {
    if (this.active || this.host.items().length === 0)
      return;
    const saved = captureGameView(this.host.camera, this.host.navigation), abort = new AbortController();
    const revision = ++this.revision;
    this.state = { kind: 'preparing', saved, abort };
    this.changed();
    try {
      const geometry = await prepareSceneGeometry(this.host.items(), abort.signal);
      if (revision !== this.revision)
        return;
      const up = this.host.up() === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
      const size = geometry.bounds.getSize(new THREE.Vector3());
      const span = Math.max(size.x, size.y, size.z, 0.001);
      const point = geometry.anchor.clone();
      if (this.host.up() === 'z')
        point.z = geometry.bounds.min.z;
      else
        point.y = geometry.bounds.min.y;
      const analysis = this.suggestions ? await this.suggestions(geometry, up, abort.signal) : {suggestions: [], message: ''};
      const suggestions = analysis.suggestions;
      if (revision !== this.revision)
        return;
      const suggestion = suggestions[0];
      const config: GameConfig = { geometry, saved, normal: suggestion?.normal.clone() ?? up, point: suggestion?.point.clone() ?? point,
        eyeHeight: span * .1, support: geometry.triangles ? 'mesh' : 'virtual', confirmed: false, suggestions,
        evidence: suggestion?.evidence ?? `${analysis.message} Manual floor: starting at scene bounds, not detected. Adjust or pick a flat patch.`.trim() };
      this.state = { kind: 'setup', config, message: '' };
      this.updatePreview();
      this.changed();
    }
    catch (error) {
      if (revision !== this.revision)
        return;
      this.exit();
      if (!abort.signal.aborted)
        this.onError(error instanceof Error ? error.message : 'Could not prepare game mode.');
    }
  }
  onError: (message: string) => void = () => { };
  configure(change: Partial<Pick<GameConfig, 'normal' | 'point' | 'eyeHeight' | 'support' | 'confirmed'>>): void {
    if (this.state.kind !== 'setup')
      return;
    Object.assign(this.state.config, change);
    if (change.normal || change.point || change.eyeHeight !== undefined || change.support)
      this.state.config.confirmed = false;
    this.state.message = '';
    this.updatePreview();
    this.changed();
  }
  chooseSuggestion(index: number): void {
    const config = this.config, proposal = config?.suggestions[index];
    if (!config || !proposal)
      return;
    config.evidence = proposal.evidence;
    this.configure({ normal: proposal.normal.clone(), point: proposal.point.clone() });
  }
  pickFloor(): void {
    if (this.state.kind !== 'setup')
      return;
    this.picking = !this.picking;
    this.host.navigation.setSuspended(this.picking);
    this.state.message = this.picking ? 'Click a flat floor patch in the scene. Escape cancels selection.' : '';
    this.changed();
  }
  start(control: 'locked' | 'keyboard'): void {
    let run: Run;
    if (this.state.kind === 'paused')
      run = this.state.run;
    else if (this.state.kind === 'setup') {
      const config = this.state.config, scale = playerScale(config.eyeHeight);
      if (!config.confirmed || !scale) {
        this.state.message = 'Confirm the floor and choose a finite positive eye height.';
        this.changed();
        return;
      }
      const frame = gameFrame(config.point, config.normal);
      const collision = config.support === 'mesh' ? collisionInFrame(config.geometry, frame) : null;
      if (config.support === 'mesh' && !collision) {
        this.state.message = 'Static collision unavailable. Explicitly choose Virtual floor to continue.';
        this.changed();
        return;
      }
      const world: WalkWorld = collision ? { kind: 'mesh', collision } : { kind: 'virtual', footprint: footprintInFrame(config.geometry.bounds, frame) };
      const walker = Walker.spawn(world, scale, new THREE.Vector3());
      if (!walker) {
        this.state.message = 'Spawn has no floor, is outside the boundary, or lacks body clearance. Pick a different floor/spawn patch or reduce eye height.';
        this.changed();
        return;
      }
      run = { config, walker, frame };
      const forward = this.host.camera.getWorldDirection(new THREE.Vector3()).applyQuaternion(frame.inverse);
      this.yaw = Math.atan2(-forward.x, -forward.z);
      this.pitch = 0;
    }
    else
      return;
    this.picking = false;
    this.keys.clear();
    run.walker.stop();
    this.host.navigation.setSuspended(true);
    this.clearPreview();
    this.host.canvas.focus({ preventScroll: true });
    if (control === 'keyboard') {
      this.state = { kind: 'playing', run, control };
      this.paintCamera(run);
      this.changed();
      return;
    }
    this.state = { kind: 'acquiring', run };
    this.changed();
    if (typeof this.host.canvas.requestPointerLock !== 'function') {
      this.onLockError();
      return;
    }
    try {
      const promise = this.host.canvas.requestPointerLock();
      if (promise)
        void promise.catch(() => this.onLockError());
    }
    catch {
      this.onLockError();
    }
  }
  pause(message = 'Paused — resume when ready.'): void {
    const state = this.state;
    if (state.kind !== 'playing' && state.kind !== 'acquiring')
      return;
    this.state = { kind: 'paused', run: state.run, message };
    this.keys.clear();
    state.run.walker.stop();
    this.releaseLock();
    this.changed();
  }
  adjust(): void {
    const state = this.state;
    if (state.kind !== 'paused')
      return;
    restoreGameView(state.run.config.saved, this.host.camera, this.host.navigation);
    this.host.navigation.setSuspended(false);
    state.run.config.confirmed = false;
    this.state = { kind: 'setup', config: state.run.config, message: '' };
    this.updatePreview();
    this.changed();
  }
  reset(): void {
    const state = this.state;
    if (state.kind !== 'playing' && state.kind !== 'paused')
      return;
    state.run.walker.reset();
    this.paintCamera(state.run);
    this.changed();
  }
  escape(): boolean {
    if (this.picking) {
      this.picking = false;
      this.host.navigation.setSuspended(false);
      if (this.state.kind === 'setup')
        this.state.message = '';
      this.changed();
      return true;
    }
    if (this.state.kind === 'playing' || this.state.kind === 'acquiring') {
      this.pause();
      return true;
    }
    if (this.active) {
      this.exit();
      return true;
    }
    return false;
  }
  /** Scene replacement must never restore the old camera into a new scene. */
  invalidate(): void { this.exit(false); }
  exit(restore = true): void {
    const state = this.state;
    if (state.kind === 'inactive')
      return;
    ++this.revision;
    const saved = state.kind === 'preparing' ? state.saved : state.kind === 'setup' ? state.config.saved : state.run.config.saved;
    if (state.kind === 'preparing')
      state.abort.abort();
    this.state = { kind: 'inactive' };
    this.picking = false;
    this.keys.clear();
    this.releaseLock();
    this.clearPreview();
    this.host.navigation.setSuspended(false);
    if (restore)
      restoreGameView(saved, this.host.camera, this.host.navigation);
    this.changed();
  }
  update(dt: number): void {
    const state = this.state;
    if (state.kind !== 'playing')
      return;
    if (!this.ownsInput()) {
      this.pause('Paused while another control is open.');
      return;
    }
    if (state.control === 'keyboard') {
      this.yaw += ((this.keys.has('ArrowLeft') ? 1 : 0) - (this.keys.has('ArrowRight') ? 1 : 0)) * dt * 1.5;
      this.pitch = THREE.MathUtils.clamp(this.pitch + ((this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('ArrowDown') ? 1 : 0)) * dt * 1.2, -1.5, 1.5);
    }
    const result = state.run.walker.update(dt, { forward: (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0),
      right: (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0), yaw: this.yaw, sprint: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') });
    this.paintCamera(state.run);
    if (result.kind === 'recover')
      this.pause(result.reason);
  }
  private paintCamera(run: Run): void {
    const camera = this.host.camera;
    camera.position.copy(toWorld(run.frame, run.walker.foot.clone().add(new THREE.Vector3(0, run.walker.scale.eyeHeight, 0))));
    this.look.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    camera.quaternion.copy(run.frame.rotation).multiply(this.look);
    camera.up.set(0, 1, 0).applyQuaternion(run.frame.rotation);
    camera.near = Math.max(run.walker.scale.eyeHeight * .005, 1e-7);
    camera.far = Math.max(run.config.saved.far, run.walker.scale.eyeHeight * 100);
    camera.updateProjectionMatrix();
  }
  private releaseLock(): void { if (document.pointerLockElement === this.host.canvas)
    document.exitPointerLock(); }
  private ownsInput(): boolean {
    return !document.querySelector('dialog[open], [role="menu"]:not([hidden])') &&
      (document.activeElement === this.host.canvas || document.activeElement === document.body);
  }
  private onLock = (): void => {
    const state = this.state;
    if (document.pointerLockElement === this.host.canvas) {
      if (state.kind === 'acquiring') {
        this.state = { kind: 'playing', run: state.run, control: 'locked' };
        this.paintCamera(state.run);
        this.changed();
      }
      else if (state.kind !== 'playing')
        this.releaseLock();
    }
    else if (state.kind === 'playing' && state.control === 'locked')
      this.pause('Mouse released. Resume to capture it again.');
  };
  private onLockError = (): void => { if (this.state.kind === 'acquiring')
    this.pause('Mouse capture unavailable. Try Start FPS again, or choose Keyboard look.'); };
  private onMouse = (event: MouseEvent): void => {
    if (this.state.kind !== 'playing' || this.state.control !== 'locked' || document.pointerLockElement !== this.host.canvas)
      return;
    if (!Number.isFinite(event.movementX) || !Number.isFinite(event.movementY)) return;
    this.yaw = THREE.MathUtils.euclideanModulo(this.yaw - event.movementX * .0025 * this.host.navigation.sensitivity + Math.PI, Math.PI * 2) - Math.PI;
    this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * .0025 * this.host.navigation.sensitivity, -1.5, 1.5);
  };
  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && this.active) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.escape();
      return;
    }
    if (this.state.kind !== 'playing')
      return;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || !this.ownsInput()) {
      this.keys.clear();
      return;
    }
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyR'].includes(event.code))
      return;
    if (event.repeat && !this.keys.has(event.code))
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.code === 'KeyR') {
      this.reset();
      return;
    }
    this.keys.add(event.code);
  };
  private onKeyUp = (event: KeyboardEvent): void => { this.keys.delete(event.code); };
  private onFocus = (): void => { if (this.playing && !this.ownsInput())
    this.pause('Paused while a control has focus.'); };
  private onVisibility = (): void => { if (document.hidden)
    this.pause('Paused while this tab was hidden.'); };
  private onBlur = (): void => { this.pause('Paused while this window was inactive.'); };
  private onPick = (event: PointerEvent): void => {
    if (!this.picking || event.button !== 0 || this.state.kind !== 'setup')
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const points = this.host.sampleGround(event.clientX, event.clientY), fit = fitPlane(points);
    if (!fit) {
      this.state.message = 'Not enough flat surface evidence here. Try another patch, or adjust the manual floor.';
      this.changed();
      return;
    }
    const center = new THREE.Vector3();
    for (let i = 0; i < points.length; i += 3)
      center.add(new THREE.Vector3(points[i], points[i + 1], points[i + 2]));
    center.multiplyScalar(1 / fit.count);
    if (fit.rms > Math.max(this.state.config.eyeHeight * .1, 1e-6)) {
      this.state.message = 'That patch is uneven. Choose a flatter area.';
      this.changed();
      return;
    }
    if (fit.normal.dot(this.state.config.normal) < 0)
      fit.normal.negate();
    this.picking = false;
    this.host.navigation.setSuspended(false);
    this.state.config.evidence = 'User-picked local patch. Confirm floor, normal direction and body scale.';
    this.configure({ normal: fit.normal, point: center });
  };
  private clearPreview(): void {
    this.preview.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials)
        material.dispose();
    } });
    this.preview.clear();
    this.host.dirty();
  }
  private updatePreview(): void {
    this.clearPreview();
    if (this.state.kind !== 'setup')
      return;
    const config = this.state.config;
    if (!playerScale(config.eyeHeight))
      return;
    const frame = gameFrame(config.point, config.normal), footprint = footprintInFrame(config.geometry.bounds, frame);
    const width = footprint.maxX - footprint.minX, depth = footprint.maxZ - footprint.minZ;
    if (!(width > 0 && depth > 0))
      return;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshBasicMaterial({ color: 0x72e7c6, transparent: true, opacity: .13, side: THREE.DoubleSide, depthWrite: false }));
    plane.rotation.x = -Math.PI / 2;
    plane.position.set((footprint.minX + footprint.maxX) / 2, 0, (footprint.minZ + footprint.maxZ) / 2);
    const group = new THREE.Group();
    group.add(plane);
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plane.geometry), new THREE.LineBasicMaterial({ color: 0x72e7c6, transparent: true, opacity: .8, depthTest: false }));
    edge.rotation.copy(plane.rotation);
    edge.position.copy(plane.position);
    group.add(edge);
    const marker = new THREE.Mesh(new THREE.RingGeometry(config.eyeHeight * .15, config.eyeHeight * .2, 32), new THREE.MeshBasicMaterial({ color: 0xffcf76, side: THREE.DoubleSide, depthTest: false }));
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = config.eyeHeight * .003;
    group.add(marker);
    const arrow = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, config.eyeHeight, 0)]), new THREE.LineBasicMaterial({ color: 0xffcf76, depthTest: false }));
    group.add(arrow);
    group.quaternion.copy(frame.rotation);
    group.position.copy(frame.origin);
    this.preview.add(group);
    this.host.dirty();
  }
  dispose(): void {
    this.exit(false);
    this.clearPreview();
    this.preview.removeFromParent();
    this.listeners.clear();
    document.removeEventListener('pointerlockchange', this.onLock);
    document.removeEventListener('pointerlockerror', this.onLockError);
    document.removeEventListener('mousemove', this.onMouse);
    document.removeEventListener('focusin', this.onFocus);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('keydown', this.onKeyDown, true);
    window.removeEventListener('keyup', this.onKeyUp, true);
    this.host.canvas.removeEventListener('pointerdown', this.onPick, true);
  }
}
