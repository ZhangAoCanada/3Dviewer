import * as THREE from 'three';
import {
  blendReleaseVelocity,
  orbitCamera,
  orbitDelta,
  panInViewPlane,
  panOnPlane,
  smoothstep,
  smoothZoomStep,
  upVector,
  wheelNotches,
  zoomToward,
} from './cameraMotion';

export type NavMode = 'orbit' | 'fly';
export type UpAxis = 'y' | 'z';
export type UpMode = 'auto' | UpAxis;

export interface NavSnapshot {
  position: THREE.Vector3;
  pivot: THREE.Vector3;
  up: UpAxis;
  mode: NavMode;
}

/** Copy a saved view onto a camera. No animation. */
export function applySnapshot(camera: THREE.PerspectiveCamera, pivot: THREE.Vector3, snapshot: NavSnapshot): void {
  camera.position.copy(snapshot.position);
  pivot.copy(snapshot.pivot);
  upVector(snapshot.up, camera.up);
  camera.lookAt(pivot);
}

export type PickKind = 'surface' | 'ground' | 'none';

export interface PickResult {
  point: THREE.Vector3;
  surface: boolean;
  kind: PickKind;
}

const LOOK_LIMIT = Math.PI / 2 - 0.04;
const INERTIA_DECAY = 7;
const PINCH_K = 0.01;
const ZOOM_TAU = 0.07;

/** Sky misses keep the orbit center. A surface or ground hit becomes the new pivot. */
export function chooseOrbitPivot(hit: PickResult, currentPivot: THREE.Vector3): THREE.Vector3 {
  if (hit.kind === 'none') return currentPivot;
  return hit.point;
}

/**
 * Orbit around the point under the pointer, zoom toward the cursor, and pan
 * so that point sticks to the mouse. Fly mode is drag-look plus WASD.
 */
export class NavigationController {
  mode: NavMode = 'orbit';
  /** World units per second at sensitivity 1. Tuned to the framed scene. */
  speed = 1.5;
  sensitivity = 1;
  up: UpAxis = 'y';
  readonly pivot = new THREE.Vector3();
  pick: ((clientX: number, clientY: number, kind?: 'wheel') => PickResult | null) | null = null;
  onPivot: ((point: THREE.Vector3 | null, kind?: PickKind) => void) | null = null;

  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number; type: string }>();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);
  private readonly homeCamera = new THREE.Vector3(1.6, 1.1, 2.8);
  private readonly homePivot = new THREE.Vector3();
  private readonly animFromCam = new THREE.Vector3();
  private readonly animToCam = new THREE.Vector3();
  private readonly animFromPivot = new THREE.Vector3();
  private readonly animToPivot = new THREE.Vector3();
  private readonly anchor = new THREE.Vector3();
  private readonly pinchCam = new THREE.Vector3();
  private readonly pinchPivot = new THREE.Vector3();
  sceneRadius = 2;
  private hasHome = false;
  private drag: 'none' | 'arm' | 'orbit' | 'pan' | 'pinch' | 'fly' = 'none';
  private dragId = -1;
  private lastX = 0;
  private lastY = 0;
  private anchorSurface = false;
  private pinchDist = 1;
  private pinchX = 0;
  private pinchY = 0;
  private yawVel = 0;
  private pitchVel = 0;
  private animating = false;
  private animT = 0;
  private readonly animDuration = 0.62;
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly move = new THREE.Vector3();
  private readonly lookRight = new THREE.Vector3();
  private readonly armedPoint = new THREE.Vector3();
  private armed: 'orbit' | 'pan' | 'none' = 'none';
  private armedKind: PickKind = 'none';
  private armX = 0;
  private armY = 0;
  private lastMoveTime = 0;
  private flyTouchCount = 0;
  private lastTap: { time: number; x: number; y: number } | null = null;
  private wheelCache: { x: number; y: number; time: number; hit: PickResult } | null = null;
  private zoomPending = 0;
  private readonly zoomAnchor = new THREE.Vector3();
  private zoomSurface = false;
  private pivotHideAt = 0;
  private flat = false;
  private maxPolar = Math.PI - 0.12;
  private readonly cursorRay = new THREE.Vector3();
  private readonly cursorNdc = new THREE.Vector3();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
  ) {
    this.camera.up.copy(this.worldUp);
    this.dom.addEventListener('pointerdown', this.onPointerDown);
    this.dom.addEventListener('pointermove', this.onPointerMove);
    this.dom.addEventListener('pointerup', this.onPointerUp);
    this.dom.addEventListener('pointercancel', this.onPointerUp);
    this.dom.addEventListener('wheel', this.onWheel, { passive: false });
    this.dom.addEventListener('dblclick', this.onDoubleClick);
    this.dom.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
  }

  setMode(mode: NavMode): void {
    this.zoomPending = 0;
    this.pivotHideAt = 0;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.mode = mode;
    this.endDrag();
    this.animating = false;
    if (mode === 'orbit') {
      const forward = this.camera.getWorldDirection(this.forward);
      this.pivot.copy(this.camera.position).addScaledVector(forward, Math.max(this.speed, this.sceneRadius * 0.35));
      this.lookAtPivot();
    }
  }

  setSensitivity(value: number): void {
    this.sensitivity = THREE.MathUtils.clamp(value, 0.25, 3);
  }

  snapshot(): NavSnapshot {
    return {
      position: this.camera.position.clone(),
      pivot: this.pivot.clone(),
      up: this.up,
      mode: this.mode,
    };
  }

  /** Put the camera back. Copies position, pivot, and up, then looks at the pivot. */
  restore(snapshot: NavSnapshot): void {
    this.mode = snapshot.mode;
    this.up = snapshot.up;
    this.animating = false;
    this.zoomPending = 0;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.endDrag();
    upVector(snapshot.up, this.worldUp);
    applySnapshot(this.camera, this.pivot, snapshot);
  }

  /** Instant frame used when a file finishes loading. */
  frame(box: THREE.Box3, groundLevel?: number): number {
    upVector(this.up, this.worldUp);
    this.camera.up.copy(this.worldUp);
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.05);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (radius / Math.sin(fov / 2)) * 0.92;
    const eye = this.up === 'z' ? new THREE.Vector3(0.55, -0.72, 0.42) : new THREE.Vector3(0.42, 0.34, 0.84);
    this.camera.position.copy(center).add(eye.normalize().multiplyScalar(distance));
    this.camera.near = Math.max(radius / 800, 0.01);
    this.camera.far = Math.max(radius * 50, 50);
    this.camera.updateProjectionMatrix();
    this.camera.up.copy(this.worldUp);
    this.pivot.copy(center);
    this.flat = groundLevel !== undefined;
    this.maxPolar = this.flat ? Math.PI / 2 + 0.05 : Math.PI - 0.12;
    if (groundLevel !== undefined) {
      if (this.up === 'z') this.pivot.z = groundLevel;
      else this.pivot.y = groundLevel;
    }
    this.lookAtPivot();
    this.speed = Math.max(radius * 0.65, 0.2);
    this.sceneRadius = radius;
    this.homeCamera.copy(this.camera.position);
    this.homePivot.copy(this.pivot);
    this.hasHome = true;
    this.animating = false;
    this.yawVel = 0;
    this.pitchVel = 0;
    return radius;
  }

  reset(animated = true): void {
    if (!this.hasHome) return;
    this.endDrag();
    if (!animated) {
      this.camera.position.copy(this.homeCamera);
      this.pivot.copy(this.homePivot);
      this.lookAtPivot();
      return;
    }
    this.startAnim(this.homeCamera, this.homePivot);
  }

  focusOn(point: THREE.Vector3, distanceScale = 0.42): void {
    const approach = this.camera.position.clone().sub(point);
    if (approach.lengthSq() < 1e-8) approach.copy(this.worldUp).add(new THREE.Vector3(0.2, 0, 0.4));
    const current = approach.length();
    const distance = THREE.MathUtils.clamp(
      current * distanceScale,
      this.minDistance() * 8,
      Math.max(this.sceneRadius * 0.55, this.minDistance() * 10),
    );
    approach.normalize().multiplyScalar(distance);
    this.endDrag();
    this.startAnim(point.clone().add(approach), point);
  }

  /** True while a drag, coast, flight, or camera animation is changing the view. */
  isMoving(): boolean {
    if (this.animating || this.drag !== 'none') return true;
    if (Math.abs(this.zoomPending) > 1e-3) return true;
    if (Math.abs(this.yawVel) > 1e-4 || Math.abs(this.pitchVel) > 1e-4) return true;
    return this.mode === 'fly' && this.keys.size > 0;
  }

  update(dt: number): void {
    if (this.animating) {
      this.animT += dt;
      const u = smoothstep(this.animT / this.animDuration);
      this.camera.position.lerpVectors(this.animFromCam, this.animToCam, u);
      this.pivot.lerpVectors(this.animFromPivot, this.animToPivot, u);
      this.lookAtPivot();
      if (this.animT >= this.animDuration) this.animating = false;
      return;
    }
    if (this.mode === 'orbit') {
      this.applyPendingZoom(dt);
      if (this.drag === 'none' && (Math.abs(this.yawVel) > 1e-4 || Math.abs(this.pitchVel) > 1e-4)) {
        const remain = Math.hypot(this.yawVel, this.pitchVel) / INERTIA_DECAY;
        if (remain < 0.01) {
          this.yawVel = 0;
          this.pitchVel = 0;
          if (!(this.pivotHideAt > performance.now())) this.onPivot?.(null);
          return;
        }
        orbitCamera(this.camera, this.pivot, this.worldUp, this.yawVel * dt, this.pitchVel * dt, this.maxPolar);
        const decay = Math.exp(-INERTIA_DECAY * dt);
        this.yawVel *= decay;
        this.pitchVel *= decay;
      }
      this.hideWheelPivot();
      return;
    }
    this.updateFly(dt);
  }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('pointercancel', this.onPointerUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('dblclick', this.onDoubleClick);
    this.dom.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
  }

  private minDistance(): number {
    return Math.max(this.camera.near * 3, this.sceneRadius * 0.0008, 0.02);
  }

  private lookAtPivot(): void {
    this.camera.up.copy(this.worldUp);
    this.camera.lookAt(this.pivot);
  }

  private startAnim(camera: THREE.Vector3, pivot: THREE.Vector3): void {
    this.animFromCam.copy(this.camera.position);
    this.animFromPivot.copy(this.pivot);
    this.animToCam.copy(camera);
    this.animToPivot.copy(pivot);
    this.animT = 0;
    this.animating = true;
    this.zoomPending = 0;
    this.pivotHideAt = 0;
    this.yawVel = 0;
    this.pitchVel = 0;
    this.onPivot?.(null);
  }

  private query(clientX: number, clientY: number, kind?: 'wheel'): PickResult {
    const hit = this.pick?.(clientX, clientY, kind);
    if (hit) return hit;
    return { point: this.pivot.clone(), surface: false, kind: 'none' };
  }

  private capture(pointerId: number): void {
    try {
      this.dom.setPointerCapture(pointerId);
    } catch {
      /* The pointer is already gone, or the event was synthesized. */
    }
  }

  private endDrag(): void {
    const coast = this.drag === 'orbit' && (Math.abs(this.yawVel) > 1e-4 || Math.abs(this.pitchVel) > 1e-4);
    this.drag = 'none';
    this.armed = 'none';
    this.camera.quaternion.normalize();
    if (!coast) this.onPivot?.(null);
  }

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    this.animating = false;
    this.zoomPending = 0;
    this.pivotHideAt = 0;
    this.onPivot?.(null);
    if (this.mode === 'fly') {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      this.drag = 'fly';
      this.dragId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.capture(event.pointerId);
      return;
    }
    if (event.pointerType === 'touch') {
      this.beginTouch();
      return;
    }
    if (event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
      this.armDrag('orbit', event.clientX, event.clientY);
    } else if (event.button === 1 || event.button === 2 || event.shiftKey || event.ctrlKey || event.metaKey) {
      this.armDrag('pan', event.clientX, event.clientY);
    } else {
      return;
    }
    this.dragId = event.pointerId;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.capture(event.pointerId);
  };

  private beginTouch(): void {
    const touches = [...this.pointers.entries()].filter(([, p]) => p.type === 'touch');
    if (touches.length >= 2) {
      const [a, b] = touches;
      if (!a || !b) return;
      const hit = this.query((a[1].x + b[1].x) / 2, (a[1].y + b[1].y) / 2);
      this.anchor.copy(hit.point);
      this.anchorSurface = hit.surface;
      this.pinchCam.copy(this.camera.position);
      this.pinchPivot.copy(this.pivot);
      this.pinchDist = Math.max(8, Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y));
      this.pinchX = (a[1].x + b[1].x) / 2;
      this.pinchY = (a[1].y + b[1].y) / 2;
      this.drag = 'pinch';
      this.onPivot?.(null);
      this.yawVel = 0;
      this.pitchVel = 0;
      this.capture(a[0]);
      this.capture(b[0]);
      return;
    }
    const only = touches[0];
    if (!only) return;
    this.armDrag('orbit', only[1].x, only[1].y);
    this.dragId = only[0];
    this.capture(only[0]);
  };

  private armDrag(kind: 'orbit' | 'pan', x: number, y: number): void {
    const hit = this.query(x, y);
    this.armed = kind;
    this.armedKind = hit.kind;
    this.armedPoint.copy(kind === 'orbit' ? chooseOrbitPivot(hit, this.pivot) : hit.point);
    this.anchorSurface = hit.surface;
    this.armX = x;
    this.armY = y;
    this.drag = 'arm';
    this.yawVel = 0;
    this.pitchVel = 0;
  }

  private onPointerMove = (event: PointerEvent): void => {
    const prev = this.pointers.get(event.pointerId);
    if (prev) this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: prev.type });
    if (this.mode === 'fly') {
      if (this.drag !== 'fly' || event.pointerId !== this.dragId) return;
      this.moveFlyPointer(event);
      return;
    }
    if (this.drag === 'pinch') {
      this.movePinch();
      return;
    }
    if (event.pointerId !== this.dragId || (this.drag !== 'arm' && this.drag !== 'orbit' && this.drag !== 'pan')) return;
    if (this.drag === 'arm') {
      if (Math.hypot(event.clientX - this.armX, event.clientY - this.armY) < 4) return;
      if (this.armed === 'orbit') {
        // The picked point becomes the orbit center. Looking at it would
        // swing the camera onto that point before the drag has moved.
        this.pivot.copy(this.armedPoint);
        this.onPivot?.(this.pivot, this.armedKind);
      } else {
        this.anchor.copy(this.armedPoint);
        this.onPivot?.(this.anchor, this.armedKind);
      }
      this.drag = this.armed === 'pan' ? 'pan' : 'orbit';
      this.lastX = this.armX;
      this.lastY = this.armY;
    }
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (dx === 0 && dy === 0) return;
    if (this.drag === 'orbit') {
      const { yaw, pitch } = orbitDelta(dx, dy, this.sensitivity);
      orbitCamera(this.camera, this.pivot, this.worldUp, yaw, pitch, this.maxPolar);
      const dtMs = event.timeStamp - this.lastMoveTime;
      this.lastMoveTime = event.timeStamp;
      this.yawVel = blendReleaseVelocity(this.yawVel, dtMs, yaw);
      this.pitchVel = blendReleaseVelocity(this.pitchVel, dtMs, pitch);
      return;
    }
    if (this.flat) {
      const rayDir = this.unproject(event.clientX, event.clientY);
      if (panOnPlane(this.camera, this.pivot, this.anchor, rayDir, this.worldUp)) return;
    }
    panInViewPlane(this.camera, this.pivot, this.camera.fov, this.dom.clientHeight, dx, dy, this.anchor);
  }

  private unproject(clientX: number, clientY: number): THREE.Vector3 {
    const rect = this.dom.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    const ndcY = -((clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
    this.cursorNdc.set(ndcX, ndcY, 0.5);
    this.camera.updateMatrixWorld();
    this.cursorRay.copy(this.cursorNdc).unproject(this.camera).sub(this.camera.position).normalize();
    return this.cursorRay;
  };

  private movePinch(): void {
    const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
    if (touches.length < 2) return;
    const a = touches[0];
    const b = touches[1];
    if (!a || !b) return;
    const dist = Math.max(8, Math.hypot(a.x - b.x, a.y - b.y));
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    this.camera.position.copy(this.pinchCam);
    this.pivot.copy(this.pinchPivot);
    const scale = this.pinchDist / dist;
    const notches = Math.log(Math.max(1e-3, scale)) / 0.38;
    zoomToward(
      this.camera.position,
      this.pivot,
      this.anchor,
      notches / Math.max(0.35, this.sensitivity),
      this.sensitivity,
      this.minDistance(),
      this.anchorSurface,
    );
    panInViewPlane(
      this.camera,
      this.pivot,
      this.camera.fov,
      this.dom.clientHeight,
      cx - this.pinchX,
      cy - this.pinchY,
      this.anchor,
    );
  }

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (event.pointerType === 'touch' && this.mode === 'orbit' && this.drag === 'arm') {
      const now = event.timeStamp;
      const prev = this.lastTap;
      const repeat =
        prev !== null && now - prev.time <= 300 && Math.hypot(event.clientX - prev.x, event.clientY - prev.y) <= 24;
      if (repeat) {
        this.lastTap = null;
        this.focusOn(this.query(event.clientX, event.clientY).point);
        return;
      }
      this.lastTap = { time: now, x: event.clientX, y: event.clientY };
    }
    if (this.mode === 'orbit' && this.drag === 'pinch') {
      if ([...this.pointers.values()].filter((p) => p.type === 'touch').length >= 2) return;
      if (this.pointers.size === 1) this.beginTouch();
      else this.endDrag();
      return;
    }
    if (this.drag !== 'none' && (event.pointerId === this.dragId || this.pointers.size === 0)) {
      const stopped = event.timeStamp - this.lastMoveTime > 80;
      const showInertia = this.drag === 'orbit' && !stopped;
      if (!showInertia) {
        this.yawVel = 0;
        this.pitchVel = 0;
      }
      this.endDrag();
    }
  };

  private onWheel = (event: WheelEvent): void => {
    if (isTypingTarget(event.target) && event.target !== this.dom) return;
    event.preventDefault();
    this.animating = false;
    if (this.mode === 'fly') {
      const direction = Math.sign(event.deltaY) || 1;
      this.camera.getWorldDirection(this.forward);
      this.camera.position.addScaledVector(this.forward, -direction * this.speed * 0.18 * this.sensitivity);
      return;
    }
    const hit = this.cachedWheelHit(event.clientX, event.clientY, event.timeStamp);
    this.zoomAnchor.copy(hit.point);
    this.zoomSurface = hit.surface;
    this.onPivot?.(this.zoomAnchor, hit.kind);
    this.pivotHideAt = performance.now() + 350;
    if (event.ctrlKey && event.deltaMode === 0) {
      const notches = (-event.deltaY * PINCH_K) / (0.38 * this.sensitivity);
      zoomToward(
        this.camera.position,
        this.pivot,
        this.zoomAnchor,
        notches,
        this.sensitivity,
        this.minDistance(),
        this.zoomSurface,
      );
    } else {
      this.zoomPending += -wheelNotches(event.deltaY, event.deltaMode);
    }
    this.yawVel = 0;
    this.pitchVel = 0;
  };

  private applyPendingZoom(dt: number): void {
    if (Math.abs(this.zoomPending) <= 1e-3) {
      this.zoomPending = 0;
      return;
    }
    const step = smoothZoomStep(this.zoomPending, dt, ZOOM_TAU);
    zoomToward(
      this.camera.position,
      this.pivot,
      this.zoomAnchor,
      step,
      this.sensitivity,
      this.minDistance(),
      this.zoomSurface,
    );
    this.zoomPending -= step;
    if (Math.abs(this.zoomPending) < 1e-3) this.zoomPending = 0;
  }

  private hideWheelPivot(): void {
    if (this.pivotHideAt <= 0 || performance.now() < this.pivotHideAt || this.drag !== 'none') return;
    if (Math.abs(this.yawVel) > 1e-4 || Math.abs(this.pitchVel) > 1e-4) return;
    this.pivotHideAt = 0;
    this.onPivot?.(null);
  }

  private onDoubleClick = (event: MouseEvent): void => {
    if (this.mode !== 'orbit') return;
    event.preventDefault();
    const hit = this.query(event.clientX, event.clientY);
    this.focusOn(hit.point);
  };

  private cachedWheelHit(x: number, y: number, time: number): PickResult {
    const cached = this.wheelCache;
    if (cached && Math.hypot(x - cached.x, y - cached.y) <= 3 && time - cached.time < 200) return cached.hit;
    const hit = this.query(x, y, 'wheel');
    this.wheelCache = { x, y, time, hit };
    return hit;
  }

  private moveFlyPointer(event: PointerEvent): void {
    if (event.pointerType === 'touch') {
      const touches = [...this.pointers.values()].filter((p) => p.type === 'touch');
      if (touches.length !== this.flyTouchCount) {
        this.flyTouchCount = touches.length;
        if (touches.length > 0) {
          let sum = 0;
          for (const touch of touches) sum += touch.y;
          this.lastY = sum / touches.length;
        }
        return;
      }
    }
    if (this.pointers.size >= 2 && event.pointerType === 'touch') {
      const ys = [...this.pointers.values()].map((p) => p.y);
      const avg = ys.reduce((sum, y) => sum + y, 0) / ys.length;
      const delta = avg - this.lastY;
      this.lastY = avg;
      this.camera.getWorldDirection(this.forward);
      this.camera.position.addScaledVector(this.forward, -delta * this.speed * 0.01 * this.sensitivity);
      return;
    }
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.lookFly(dx, dy);
  }

  private lookFly(dx: number, dy: number): void {
    const sens = 0.005 * this.sensitivity;
    const yawQ = new THREE.Quaternion().setFromAxisAngle(this.worldUp, -dx * sens);
    this.camera.quaternion.premultiply(yawQ);
    this.camera.getWorldDirection(this.forward);
    const elev = Math.asin(THREE.MathUtils.clamp(this.forward.dot(this.worldUp), -1, 1));
    const next = THREE.MathUtils.clamp(elev - dy * sens, -LOOK_LIMIT, LOOK_LIMIT);
    this.lookRight.set(1, 0, 0).applyQuaternion(this.camera.quaternion).normalize();
    const pitchQ = new THREE.Quaternion().setFromAxisAngle(this.lookRight, next - elev);
    this.camera.quaternion.premultiply(pitchQ);
  }

  private updateFly(dt: number): void {
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3.5 : 1;
    const step = this.speed * sprint * dt * this.sensitivity;
    this.camera.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, this.worldUp);
    if (this.right.lengthSq() < 1e-8) this.right.set(1, 0, 0);
    else this.right.normalize();
    this.move.set(0, 0, 0);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.move.add(this.forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.move.sub(this.forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.move.add(this.right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.move.sub(this.right);
    if (this.keys.has('KeyE') || this.keys.has('Space')) this.move.add(this.worldUp);
    if (this.keys.has('KeyQ')) this.move.sub(this.worldUp);
    if (this.move.lengthSq() > 0) {
      this.move.normalize().multiplyScalar(step);
      this.camera.position.add(this.move);
    }
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (isTypingTarget(event.target)) return;
    if (event.metaKey || event.ctrlKey) return;
    this.keys.add(event.code);
    if (this.mode === 'fly' && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.code === 'MetaLeft' || event.code === 'MetaRight') {
      this.keys.clear();
      return;
    }
    this.keys.delete(event.code);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.pointers.clear();
    this.endDrag();
  };
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
