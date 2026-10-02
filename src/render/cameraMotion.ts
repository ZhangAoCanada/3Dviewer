import * as THREE from 'three';

/** Polar angle limits keep the camera from flipping over the up axis. */
const MIN_POLAR = 0.12;
const MAX_POLAR = Math.PI - 0.12;
const YAW_PER_PX = 0.0052;
const PITCH_PER_PX = 0.0042;
const MAX_ORBIT_STEP = 0.9;

const _offset = new THREE.Vector3();
const _up = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _probe = new THREE.Vector3();
const _view = new THREE.Vector3();
const _toAnchor = new THREE.Vector3();
const _cursor = new THREE.Vector3();
const _right = new THREE.Vector3();
const _screenUp = new THREE.Vector3();
const _spin = new THREE.Quaternion();

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

/** Thickness along `up` is at most 0.28 of the widest other side. */
export function isFlatScene(size: THREE.Vector3, up: 'y' | 'z'): boolean {
  const sx = Math.max(Math.abs(size.x), 1e-8);
  const sy = Math.max(Math.abs(size.y), 1e-8);
  const sz = Math.max(Math.abs(size.z), 1e-8);
  const thickness = up === 'z' ? sz : sy;
  const other = up === 'z' ? Math.max(sx, sy) : Math.max(sx, sz);
  return thickness / other <= 0.28;
}

/**
 * Ray against the plane `up · p = level`. `dir` is a unit direction.
 * Returns null when the hit is behind the origin, the ray is parallel, or `t` exceeds `maxT`.
 */
export function groundPlaneHit(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  up: THREE.Vector3,
  level: number,
  maxT: number,
): THREE.Vector3 | null {
  const denom = up.dot(dir);
  if (Math.abs(denom) < 1e-8) return null;
  const t = (level - up.dot(origin)) / denom;
  if (t <= 0 || t > maxT) return null;
  return origin.clone().addScaledVector(dir, t);
}

/** Pointer deltas to yaw and pitch. The 0.9 rad clamp only catches capture glitches. */
export function orbitDelta(dx: number, dy: number, sensitivity: number): { yaw: number; pitch: number } {
  return {
    yaw: THREE.MathUtils.clamp(-dx * YAW_PER_PX * sensitivity, -MAX_ORBIT_STEP, MAX_ORBIT_STEP),
    pitch: THREE.MathUtils.clamp(dy * PITCH_PER_PX * sensitivity, -MAX_ORBIT_STEP, MAX_ORBIT_STEP),
  };
}

/** Fraction of `pending` consumed this frame. `tau` is the smoothing time constant. */
export function smoothZoomStep(pending: number, dt: number, tau: number): number {
  return pending * (1 - Math.exp(-dt / tau));
}

/**
 * Grab-style orbit. Drag right yaws so the pivot moves with the pointer.
 * `quaternion`, when set, turns with the same rotation so the pivot stays
 * under the cursor. A new pivot must not be followed by `lookAt`: that
 * retargets the camera and, near the up axis, flips the basis.
 */
export function orbitAround(
  camera: THREE.Vector3,
  pivot: THREE.Vector3,
  worldUp: THREE.Vector3,
  yaw: number,
  pitch: number,
  quaternion?: THREE.Quaternion,
  maxPolar = MAX_POLAR,
): void {
  _offset.subVectors(camera, pivot);
  if (_offset.lengthSq() < 1e-12) _offset.copy(worldUp).multiplyScalar(1);
  _up.copy(worldUp).normalize();
  rotateAbout(_up, yaw, _offset, quaternion);
  const delta = pitchDelta(polarOf(_offset, _up), pitch, maxPolar);
  if (delta !== 0) {
    pitchAxis(_offset, _up, quaternion ?? null);
    rotateAbout(_axis, delta, _offset, quaternion);
  }
  camera.copy(pivot).add(_offset);
}

/** Orbit a camera around `pivot` without rebuilding its basis via `lookAt`. */
export function orbitCamera(
  camera: THREE.Camera,
  pivot: THREE.Vector3,
  worldUp: THREE.Vector3,
  yaw: number,
  pitch: number,
  maxPolar = MAX_POLAR,
): void {
  orbitAround(camera.position, pivot, worldUp, yaw, pitch, camera.quaternion, maxPolar);
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
 * Translate in the camera's view plane so `anchor` tracks the pointer.
 * The basis is the camera quaternion, so an off-axis pivot does not rotate the pan.
 * `dx`/`dy` are pixels, Y positive down.
 */
export function panInViewPlane(
  camera: THREE.Camera,
  pivot: THREE.Vector3,
  fovDeg: number,
  viewHeightPx: number,
  dxPx: number,
  dyPx: number,
  anchor: THREE.Vector3,
): void {
  const quaternion = camera.quaternion;
  _right.set(1, 0, 0).applyQuaternion(quaternion);
  _screenUp.set(0, 1, 0).applyQuaternion(quaternion);
  _view.set(0, 0, -1).applyQuaternion(quaternion);
  _toAnchor.subVectors(anchor, camera.position);
  const depth = Math.max(_toAnchor.dot(_view), 1e-4);
  const worldPerPixel =
    (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * depth) / Math.max(1, viewHeightPx);
  _right.multiplyScalar(-dxPx * worldPerPixel);
  _right.addScaledVector(_screenUp, dyPx * worldPerPixel);
  camera.position.add(_right);
  pivot.add(_right);
}

/**
 * Slide the camera on the plane through `anchor` so that point stays under the cursor.
 * Returns false when the ray is within 5° of the horizon, behind the camera, or too long.
 */
export function panOnPlane(
  camera: THREE.Camera,
  pivot: THREE.Vector3,
  anchor: THREE.Vector3,
  rayDir: THREE.Vector3,
  up: THREE.Vector3,
): boolean {
  const slope = up.dot(rayDir);
  if (slope > -0.087) return false;
  _toAnchor.subVectors(anchor, camera.position);
  const dist = _toAnchor.length();
  const t = up.dot(_toAnchor) / slope;
  if (t <= 0 || t > 6 * dist) return false;
  _cursor.copy(camera.position).addScaledVector(rayDir, t);
  _right.subVectors(anchor, _cursor);
  const cap = 0.5 * dist;
  const len = _right.length();
  if (len > cap && len > 1e-12) _right.multiplyScalar(cap / len);
  camera.position.add(_right);
  pivot.add(_right);
  return true;
}

const RELEASE_DT_MIN = 1 / 240;
const RELEASE_DT_MAX = 1 / 10;

/** One pointer sample of orbit release velocity. `dtMs` is clamped to 240–10 Hz. */
export function blendReleaseVelocity(velocity: number, dtMs: number, angle: number): number {
  const dt = THREE.MathUtils.clamp(dtMs / 1000, RELEASE_DT_MIN, RELEASE_DT_MAX);
  return THREE.MathUtils.clamp(THREE.MathUtils.lerp(velocity, angle / dt, 0.5), -6, 6);
}

/** Release velocity after a stream of `{ dtMs, angle }` pointer samples. */
export function releaseVelocity(samples: readonly { dtMs: number; angle: number }[]): number {
  let velocity = 0;
  for (const sample of samples) velocity = blendReleaseVelocity(velocity, sample.dtMs, sample.angle);
  return velocity;
}

function polarOf(offset: THREE.Vector3, up: THREE.Vector3): number {
  const len = offset.length();
  if (len < 1e-12) return 0;
  return Math.acos(THREE.MathUtils.clamp(offset.dot(up) / len, -1, 1));
}

/**
 * Rotation angle around `offset × up`. A positive angle lowers the polar
 * angle, so drag-down (positive pitch) moves the camera toward the up pole
 * and the clamp stops it just short of that pole.
 */
function pitchDelta(polar: number, pitch: number, maxPolar = MAX_POLAR): number {
  if (pitch === 0) return 0;
  const polarStep = -pitch;
  let clamped = polarStep;
  if (polar + polarStep < MIN_POLAR) clamped = Math.min(0, MIN_POLAR - polar);
  else if (polar + polarStep > maxPolar) clamped = Math.max(0, maxPolar - polar);
  return -clamped;
}

function pitchAxis(offset: THREE.Vector3, up: THREE.Vector3, quaternion: THREE.Quaternion | null): void {
  _axis.crossVectors(offset, up);
  if (_axis.lengthSq() < 1e-8 * Math.max(offset.lengthSq(), 1)) {
    if (quaternion) {
      _axis.set(1, 0, 0).applyQuaternion(quaternion);
      _axis.addScaledVector(up, -_axis.dot(up));
    }
    if (_axis.lengthSq() < 1e-10) {
      _axis.set(1, 0, 0).cross(up);
      if (_axis.lengthSq() < 1e-10) _axis.set(0, 1, 0);
    }
    _axis.normalize();
    _probe.copy(offset);
    if (_probe.lengthSq() < 1e-12) _probe.copy(up);
    _probe.applyAxisAngle(_axis, 1e-3);
    if (_probe.dot(up) > offset.dot(up)) _axis.negate();
    return;
  }
  _axis.normalize();
}

function rotateAbout(
  axis: THREE.Vector3,
  angle: number,
  offset: THREE.Vector3,
  quaternion?: THREE.Quaternion,
): void {
  if (angle === 0) return;
  _spin.setFromAxisAngle(axis, angle);
  offset.applyQuaternion(_spin);
  quaternion?.premultiply(_spin);
}

export function smoothstep(t: number): number {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

export function wheelNotches(deltaY: number, deltaMode: number): number {
  const pixels = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return pixels / 125;
}
