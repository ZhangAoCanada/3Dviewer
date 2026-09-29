import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type NavMode = 'orbit' | 'fly';

const LOOK_LIMIT = Math.PI / 2 - 0.02;

/**
 * Orbit (mouse, wheel, touch) plus a fly / FPS mode on the same camera.
 * Orbit uses Three.js OrbitControls. Fly uses drag-look and WASD.
 */
export class NavigationController {
  readonly orbit: OrbitControls;
  mode: NavMode = 'orbit';
  /** World units per second at speed scale 1. Tuned to the framed scene. */
  speed = 1.5;
  private readonly keys = new Set<string>();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private flyDragging = false;
  private lastX = 0;
  private lastY = 0;
  private lastPinchY = 0;
  private readonly euler = new THREE.Euler(0, 0, 0, 'YXZ');
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly move = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
  ) {
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.rotateSpeed = 0.75;
    this.orbit.zoomSpeed = 0.85;
    this.orbit.panSpeed = 0.75;
    this.orbit.screenSpacePanning = true;
    this.orbit.target.set(0, 0, 0);
    this.orbit.listenToKeyEvents(window);
    this.dom.addEventListener('pointerdown', this.onPointerDown);
    this.dom.addEventListener('pointermove', this.onPointerMove);
    this.dom.addEventListener('pointerup', this.onPointerUp);
    this.dom.addEventListener('pointercancel', this.onPointerUp);
    this.dom.addEventListener('wheel', this.onWheel, { passive: false });
    this.dom.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  setMode(mode: NavMode): void {
    this.mode = mode;
    this.orbit.enabled = mode === 'orbit';
    this.flyDragging = false;
    this.pointers.clear();
    if (mode === 'fly') {
      this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    }
  }

  focusOn(point: THREE.Vector3): void {
    const offset = this.camera.position.clone().sub(this.orbit.target);
    const distance = Math.max(offset.length(), this.speed * 0.35);
    if (offset.lengthSq() < 1e-8) offset.set(0.4, 0.25, 1);
    offset.normalize();
    this.orbit.target.copy(point);
    this.camera.position.copy(point).addScaledVector(offset, distance);
    this.orbit.update();
    if (this.mode === 'fly') this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
  }

  frame(box: THREE.Box3): number {
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 0.05);
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const distance = (radius / Math.sin(fov / 2)) * 0.85;
    this.camera.position.set(center.x + distance * 0.45, center.y + distance * 0.28, center.z + distance * 0.85);
    this.camera.near = Math.max(radius / 500, 0.01);
    this.camera.far = Math.max(radius * 40, 50);
    this.camera.updateProjectionMatrix();
    this.orbit.target.copy(center);
    this.orbit.update();
    this.speed = Math.max(radius * 0.65, 0.2);
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    return radius;
  }

  update(dt: number): void {
    if (this.mode === 'orbit') {
      this.orbit.update();
      return;
    }
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 3.5 : 1;
    const step = this.speed * sprint * dt;
    this.camera.getWorldDirection(this.forward);
    this.right.crossVectors(this.forward, this.up).normalize();
    this.move.set(0, 0, 0);
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.move.add(this.forward);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.move.sub(this.forward);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.move.add(this.right);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.move.sub(this.right);
    if (this.keys.has('KeyE') || this.keys.has('Space')) this.move.add(this.up);
    if (this.keys.has('KeyQ')) this.move.sub(this.up);
    if (this.move.lengthSq() > 0) {
      this.move.normalize().multiplyScalar(step);
      this.camera.position.add(this.move);
    }
  }

  dispose(): void {
    this.orbit.dispose();
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('pointercancel', this.onPointerUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private onPointerDown = (event: PointerEvent): void => {
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.mode !== 'fly') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.flyDragging = true;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.lastPinchY = event.clientY;
    this.dom.setPointerCapture?.(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    if (this.pointers.has(event.pointerId)) {
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (this.mode !== 'fly' || !this.flyDragging) return;
    if (this.pointers.size >= 2) {
      const ys = [...this.pointers.values()].map((p) => p.y);
      const avg = ys.reduce((sum, y) => sum + y, 0) / ys.length;
      const delta = avg - this.lastPinchY;
      this.lastPinchY = avg;
      this.camera.getWorldDirection(this.forward);
      this.camera.position.addScaledVector(this.forward, -delta * this.speed * 0.01);
      return;
    }
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.euler.setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.euler.y -= dx * 0.005;
    this.euler.x -= dy * 0.005;
    this.euler.x = Math.max(-LOOK_LIMIT, Math.min(LOOK_LIMIT, this.euler.x));
    this.camera.quaternion.setFromEuler(this.euler);
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
    if (this.pointers.size === 0) this.flyDragging = false;
  };

  private onWheel = (event: WheelEvent): void => {
    if (this.mode !== 'fly') return;
    event.preventDefault();
    const direction = Math.sign(event.deltaY);
    this.camera.getWorldDirection(this.forward);
    this.camera.position.addScaledVector(this.forward, -direction * this.speed * 0.18);
  };

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
    this.flyDragging = false;
    this.pointers.clear();
  };
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}
