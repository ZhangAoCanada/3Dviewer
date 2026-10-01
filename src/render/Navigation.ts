import * as THREE from 'three';
import { orbitAround, panInViewPlane, smoothstep, upVector, wheelNotches, zoomToward } from './cameraMotion';

export type NavMode = 'orbit' | 'fly';
export type UpAxis = 'y' | 'z';
export type UpMode = 'auto' | UpAxis;

export interface PickResult {
  point: THREE.Vector3;
  surface: boolean;
}

const LOOK_LIMIT = Math.PI / 2 - 0.04;
const INERTIA_DECAY = 5.2;

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
  pick: ((clientX: number, clientY: number) => PickResult | null) | null = null;
  onPivot: ((point: THREE.Vector3 | null) => void) | null = null;

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
  private sceneRadius = 2;
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
  private armX = 0;
  private armY = 0;

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
  }

  setMode(mode: NavMode): void {
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

  /** Instant frame used when a file finishes loading. */
  frame(box: THREE.Box3): number {
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
    this.lookAtPivot();
    this.speed = Math.max(radius * 0.65, 0.2);
    this.sceneRadius = radius;
    this.homeCamera.copy(this.camera.position);
    this.homePivot.copy(center);
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
      if (this.drag === 'none' && (Math.abs(this.yawVel) > 1e-4 || Math.abs(this.pitchVel) > 1e-4)) {
        orbitAround(this.camera.position, this.pivot, this.worldUp, this.yawVel * dt, this.pitchVel * dt);
        this.lookAtPivot();
        const decay = Math.exp(-INERTIA_DECAY * dt);
        this.yawVel *= decay;
        this.pitchVel *= decay;
      }
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
    this.yawVel = 0;
    this.pitchVel = 0;
  }

  private query(clientX: number, clientY: number): PickResult {
    const hit = this.pick?.(clientX, clientY);
    if (hit) return hit;
    return { point: this.pivot.clone(), surface: false };
  }

  private capture(pointerId: number): void {
    try {
      this.dom.setPointerCapture(pointerId);
    } catch {
      /* The pointer is already gone, or the event was synthesized. */
    }
  }

  private endDrag(): void {
    this.drag = 'none';
    this.armed = 'none';
    this.onPivot?.(null);
  }

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    this.animating = false;
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
    this.armedPoint.copy(hit.point);
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
        this.pivot.copy(this.armedPoint);
        this.lookAtPivot();
        this.onPivot?.(this.pivot);
      } else {
        this.anchor.copy(this.armedPoint);
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
      const yaw = THREE.MathUtils.clamp(-dx * 0.0052 * this.sensitivity, -0.18, 0.18);
      const pitch = THREE.MathUtils.clamp(dy * 0.0042 * this.sensitivity, -0.16, 0.16);
      orbitAround(this.camera.position, this.pivot, this.worldUp, yaw, pitch);
      this.lookAtPivot();
      const dt = 1 / 60;
      this.yawVel = yaw / dt;
      this.pitchVel = pitch / dt;
      return;
    }
    const depth = Math.max(this.camera.position.distanceTo(this.anchor), this.minDistance());
    panInViewPlane(
      this.camera.position,
      this.pivot,
      this.worldUp,
      this.camera.fov,
      this.dom.clientHeight,
      dx,
      dy,
      depth,
    );
    this.lookAtPivot();
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
    this.lookAtPivot();
    panInViewPlane(
      this.camera.position,
      this.pivot,
      this.worldUp,
      this.camera.fov,
      this.dom.clientHeight,
      cx - this.pinchX,
      cy - this.pinchY,
      Math.max(this.camera.position.distanceTo(this.anchor), this.minDistance()),
    );
    this.lookAtPivot();
  }

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.mode === 'orbit' && this.drag === 'pinch') {
      if ([...this.pointers.values()].filter((p) => p.type === 'touch').length >= 2) return;
      if (this.pointers.size === 1) this.beginTouch();
      else this.endDrag();
      return;
    }
    if (this.drag !== 'none' && (event.pointerId === this.dragId || this.pointers.size === 0)) {
      const showInertia = this.drag === 'orbit';
      this.endDrag();
      if (!showInertia) {
        this.yawVel = 0;
        this.pitchVel = 0;
      }
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
    const hit = this.query(event.clientX, event.clientY);
    const notches = -wheelNotches(event.deltaY, event.deltaMode);
    zoomToward(
      this.camera.position,
      this.pivot,
      hit.point,
      notches,
      this.sensitivity,
      this.minDistance(),
      hit.surface,
    );
    this.lookAtPivot();
    this.yawVel = 0;
    this.pitchVel = 0;
  };

  private onDoubleClick = (event: MouseEvent): void => {
    if (this.mode !== 'orbit') return;
    event.preventDefault();
    const hit = this.query(event.clientX, event.clientY);
    this.focusOn(hit.point);
  };

  private moveFlyPointer(event: PointerEvent): void {
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
    this.keys.add(event.code);
    if (this.mode === 'fly' && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
    }
  };

  private onKeyUp = (event: KeyboardEvent): void => {
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
