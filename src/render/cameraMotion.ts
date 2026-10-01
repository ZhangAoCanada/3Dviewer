import * as THREE from 'three';

/** Polar angle limits keep the camera from flipping over the up axis. */
const MIN_POLAR = 0.12;
const MAX_POLAR = Math.PI - 0.12;

const _offset = new THREE.Vector3();
const _up = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _view = new THREE.Vector3();
const _toAnchor = new THREE.Vector3();
const _cursor = new THREE.Vector3();
const _right = new THREE.Vector3();
const _screenUp = new THREE.Vector3();

/**
 * Flat drone scans are wide in X/Y and short in Z. A tall or cubic scene stays Y-up
 * until the user picks Z-up.
 */
export function detectUpAxis(size: THREE.Vector3): 'y' | 'z' {
  const sx = Math.max(Math.abs(size.x), 1e-8);
  const sy = Math.max(Math.abs(size.y), 1e-8);
  const sz = Math.max(Math.abs(size.z), 1e-8);
  const zThin = sz / Math.max(sx, sy);
  const yThin = sy / Math.max(sx, sz);
  if (zThin <= 0.28 && zThin < yThin) return 'z';
  return 'y';
}

export function upVector(axis: 'y' | 'z', target = new THREE.Vector3()): THREE.Vector3 {
  return axis === 'z' ? target.set(0, 0, 1) : target.set(0, 1, 0);
}

/** Grab-style orbit. Drag right yaws so the pivot moves with the pointer. */
export function orbitAround(
  camera: THREE.Vector3,
  pivot: THREE.Vector3,
  worldUp: THREE.Vector3,
  yaw: number,
  pitch: number,
): void {
  _offset.subVectors(camera, pivot);
  if (_offset.lengthSq() < 1e-12) _offset.copy(worldUp).multiplyScalar(1);
  _up.copy(worldUp).normalize();
  if (yaw !== 0) _offset.applyAxisAngle(_up, yaw);
  _axis.crossVectors(_offset, _up);
  if (_axis.lengthSq() < 1e-10) {
    _axis.set(1, 0, 0).cross(_up);
    if (_axis.lengthSq() < 1e-10) _axis.set(0, 1, 0);
  }
  _axis.normalize();
  const polar = Math.acos(THREE.MathUtils.clamp(_offset.clone().normalize().dot(_up), -1, 1));
  const next = THREE.MathUtils.clamp(polar + pitch, MIN_POLAR, MAX_POLAR);
  if (next !== polar) _offset.applyAxisAngle(_axis, next - polar);
  camera.copy(pivot).add(_offset);
}

export function polarAngle(camera: THREE.Vector3, pivot: THREE.Vector3, worldUp: THREE.Vector3): number {
  _offset.subVectors(camera, pivot).normalize();
  _up.copy(worldUp).normalize();
  return Math.acos(THREE.MathUtils.clamp(_offset.dot(_up), -1, 1));
}

/**
 * Move the camera along the ray through `anchor` so that point stays under the cursor.
 * The pivot stays in front of the camera at a scaled orbit distance.
 * A real surface stops at `minDistance`. An empty-space anchor keeps dollying so the
 * view does not freeze on the old pivot.
 */
export function zoomToward(
  camera: THREE.Vector3,
  pivot: THREE.Vector3,
  anchor: THREE.Vector3,
  zoomInNotches: number,
  sensitivity: number,
  minDistance: number,
  surface: boolean,
): void {
  _view.subVectors(pivot, camera);
  const radius = _view.length();
  if (radius < 1e-8) return;
  _view.multiplyScalar(1 / radius);

  _toAnchor.subVectors(anchor, camera);
  const anchorDist = _toAnchor.length();
  if (anchorDist < 1e-6) return;
  _cursor.copy(_toAnchor).multiplyScalar(1 / anchorDist);

  let scale = Math.exp(-zoomInNotches * 0.38 * sensitivity);
  const maxRadius = Math.max(radius * 12, minDistance * 80);
  if (zoomInNotches > 0 && !surface && anchorDist * scale < minDistance) {
    const step = Math.max(minDistance * 0.35, radius * Math.min(0.45, 1 - scale));
    camera.addScaledVector(_cursor, step);
    pivot.addScaledVector(_cursor, step);
    return;
  }
  if (zoomInNotches > 0) {
    const minScale = Math.min(1, minDistance / anchorDist);
    if (scale < minScale) scale = minScale;
  } else if (radius * scale > maxRadius) {
    scale = maxRadius / radius;
  }

  const travel = anchorDist * (1 - scale);
  camera.addScaledVector(_cursor, travel);
  const nextRadius = THREE.MathUtils.clamp(radius * scale, minDistance * 1.2, maxRadius);
  pivot.copy(camera).addScaledVector(_view, nextRadius);
}

/**
 * Translate in the view plane so a point at `depth` tracks the pointer.
 * `dx`/`dy` are pixels, Y positive down.
 */
export function panInViewPlane(
  camera: THREE.Vector3,
  pivot: THREE.Vector3,
  worldUp: THREE.Vector3,
  fovDeg: number,
  viewHeightPx: number,
  dxPx: number,
  dyPx: number,
  depth: number,
): void {
  _view.subVectors(pivot, camera);
  const len = _view.length();
  if (len < 1e-8) return;
  _view.multiplyScalar(1 / len);
  const worldPerPixel =
    (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * Math.max(depth, 1e-4)) / Math.max(1, viewHeightPx);
  _up.copy(worldUp).normalize();
  _right.crossVectors(_view, _up);
  if (_right.lengthSq() < 1e-10) _right.set(1, 0, 0);
  else _right.normalize();
  _screenUp.crossVectors(_right, _view).normalize();
  _right.multiplyScalar(-dxPx * worldPerPixel);
  _right.addScaledVector(_screenUp, dyPx * worldPerPixel);
  camera.add(_right);
  pivot.add(_right);
}

export function smoothstep(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function wheelNotches(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return pixels / 100;
}
