import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  detectUpAxis,
  groundPlaneHit,
  isFlatScene,
  orbitAround,
  orbitCamera,
  orbitDelta,
  panInViewPlane,
  panOnPlane,
  polarAngle,
  releaseVelocity,
  smoothZoomStep,
  wheelNotches,
  zoomToward,
} from '../src/render/cameraMotion';
import { chooseOrbitPivot } from '../src/render/Navigation';
import { CoarseSurface, halfToFloat, sampleStride } from '../src/render/coarseSurface';
import { toHalf } from '../src/loaders/gaussian/packSplat';

describe('up axis', () => {
  it('treats a flat drone scan as Z-up', () => {
    expect(detectUpAxis(new THREE.Vector3(590, 490, 77))).toBe('z');
  });

  it('keeps a tall or cubic scene on Y-up', () => {
    expect(detectUpAxis(new THREE.Vector3(40, 120, 40))).toBe('y');
    expect(detectUpAxis(new THREE.Vector3(10, 10, 10))).toBe('y');
    expect(detectUpAxis(new THREE.Vector3(590, 77, 490))).toBe('y');
  });
});

describe('orbit', () => {
  it('does not flip past the up axis', () => {
    const camera = new THREE.Vector3(0, 1, 6);
    const pivot = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 40; i += 1) orbitAround(camera, pivot, up, 0, 0.4);
    const polar = polarAngle(camera, pivot, up);
    expect(polar).toBeGreaterThan(0.1);
    expect(polar).toBeLessThan(Math.PI - 0.1);
    expect(camera.distanceTo(pivot)).toBeGreaterThan(5);
  });

  it('yaws a drag-right so the camera slides across the view', () => {
    const camera = new THREE.Vector3(0, 1, 6);
    const pivot = new THREE.Vector3();
    orbitAround(camera, pivot, new THREE.Vector3(0, 1, 0), -0.35, 0);
    expect(camera.x).toBeLessThan(0);
    expect(camera.z).toBeGreaterThan(0);
  });

  it('leaves the camera matrix unchanged when the pivot moves', () => {
    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 5000);
    const up = new THREE.Vector3(0, 0, 1);
    camera.up.copy(up);
    camera.position.set(80, -60, 30);
    const home = new THREE.Vector3(0, 0, 4);
    camera.lookAt(home);
    const beforePos = camera.position.clone();
    const beforeQuat = camera.quaternion.clone();
    const picked = new THREE.Vector3(25, 10, 8);
    const before = projectOf(camera, picked);
    const pivot = home.clone();
    pivot.copy(picked);
    orbitCamera(camera, pivot, up, 0, 0);
    expect(camera.position.distanceToSquared(beforePos)).toBeLessThan(1e-16);
    expect(Math.abs(camera.quaternion.dot(beforeQuat))).toBeGreaterThan(1 - 1e-8);
    const after = projectOf(camera, picked);
    expect(after.x).toBeCloseTo(before.x, 5);
    expect(after.y).toBeCloseTo(before.y, 5);

    const jumped = new THREE.PerspectiveCamera(55, 1, 0.01, 5000);
    jumped.position.copy(beforePos);
    jumped.up.copy(up);
    jumped.quaternion.copy(beforeQuat);
    jumped.lookAt(picked);
    expect(Math.abs(jumped.quaternion.dot(beforeQuat))).toBeLessThan(0.999);
  });

  it('keeps the picked point fixed in the view while orbiting', () => {
    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 5000);
    const up = new THREE.Vector3(0, 0, 1);
    camera.up.copy(up);
    camera.position.set(80, -60, 30);
    camera.lookAt(0, 0, 4);
    const pivot = new THREE.Vector3(25, 10, 8);
    const before = projectOf(camera, pivot);
    orbitCamera(camera, pivot, up, -0.35, 0.12);
    const after = projectOf(camera, pivot);
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.y).toBeCloseTo(before.y, 4);
    expect(camera.position.distanceTo(pivot)).toBeGreaterThan(20);
  });

  it('spins a top-down view without flipping up', () => {
    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 5000);
    const up = new THREE.Vector3(0, 0, 1);
    const pivot = new THREE.Vector3();
    camera.up.copy(up);
    camera.position.set(0, 0, 12);
    camera.quaternion.identity();
    const yaw = -0.17;
    let previous = headingOf(camera);
    let sign = 0;
    for (let i = 0; i < 48; i += 1) {
      orbitCamera(camera, pivot, up, yaw, 0);
      const camUp = cameraUp(camera);
      expect(Math.abs(camUp.z)).toBeLessThan(0.02);
      const heading = headingOf(camera);
      const step = wrapAngle(heading - previous);
      expect(Math.abs(Math.abs(step) - Math.abs(yaw))).toBeLessThan(0.02);
      if (sign === 0) sign = Math.sign(step);
      expect(Math.sign(step)).toBe(sign);
      previous = heading;
      expect(camera.position.z).toBeCloseTo(12, 4);
      expect(Math.hypot(camera.position.x, camera.position.y)).toBeLessThan(1e-4);
    }
  });

  it('pitches to nadir without an azimuth flip, then yaws smoothly', () => {
    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 5000);
    const up = new THREE.Vector3(0, 0, 1);
    const pivot = new THREE.Vector3();
    camera.up.copy(up);
    camera.position.set(0, -8, 3);
    camera.lookAt(pivot);
    let previousHeading = offsetHeading(camera.position, pivot, up);
    let previousUp = cameraUp(camera);
    for (let i = 0; i < 80; i += 1) {
      orbitCamera(camera, pivot, up, 0, 0.08);
      const polar = polarAngle(camera.position, pivot, up);
      expect(polar).toBeGreaterThan(0.11);
      expect(polar).toBeLessThan(Math.PI - 0.11);
      const heading = offsetHeading(camera.position, pivot, up);
      const horizontal = horizontalLength(camera.position, pivot, up);
      if (horizontal > 0.5) {
        expect(Math.abs(wrapAngle(heading - previousHeading))).toBeLessThan(0.08);
      }
      const upNow = cameraUp(camera);
      expect(previousUp.dot(upNow)).toBeGreaterThan(0.95);
      previousHeading = heading;
      previousUp = upNow;
    }
    expect(polarAngle(camera.position, pivot, up)).toBeLessThan(0.2);
    for (let i = 0; i < 24; i += 1) {
      orbitCamera(camera, pivot, up, 0.12, 0);
      const upNow = cameraUp(camera);
      expect(previousUp.dot(upNow)).toBeGreaterThan(0.98);
      previousUp = upNow;
    }
  });
});

function projectOf(camera: THREE.PerspectiveCamera, point: THREE.Vector3): THREE.Vector3 {
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return point.clone().project(camera);
}

function cameraUp(camera: THREE.Camera): THREE.Vector3 {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
}

function headingOf(camera: THREE.Camera): number {
  const up = cameraUp(camera);
  return Math.atan2(up.x, up.y);
}

function wrapAngle(delta: number): number {
  let angle = delta;
  while (angle > Math.PI) angle -= Math.PI * 2;
  while (angle < -Math.PI) angle += Math.PI * 2;
  return angle;
}

function horizontalLength(camera: THREE.Vector3, pivot: THREE.Vector3, up: THREE.Vector3): number {
  const offset = camera.clone().sub(pivot);
  offset.addScaledVector(up, -offset.dot(up));
  return offset.length();
}

function offsetHeading(camera: THREE.Vector3, pivot: THREE.Vector3, up: THREE.Vector3): number {
  const offset = camera.clone().sub(pivot);
  offset.addScaledVector(up, -offset.dot(up));
  return Math.atan2(offset.x, offset.y);
}

describe('zoom', () => {
  it('moves farther when the surface is farther away', () => {
    const anchor = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const farCam = new THREE.Vector3(0, 2, 80);
    const nearCam = new THREE.Vector3(0, 2, 8);
    const farPivot = new THREE.Vector3(0, 2, 40);
    const nearPivot = new THREE.Vector3(0, 2, 4);
    const farBefore = farCam.distanceTo(anchor);
    const nearBefore = nearCam.distanceTo(anchor);
    zoomToward(farCam, farPivot, anchor, 1, 1, 0.2, true);
    zoomToward(nearCam, nearPivot, anchor, 1, 1, 0.2, true);
    expect(farBefore - farCam.distanceTo(anchor)).toBeGreaterThan(nearBefore - nearCam.distanceTo(anchor));
    expect(up.y).toBe(1);
  });

  it('does not pass through a surface', () => {
    const camera = new THREE.Vector3(0, 0, 6);
    const pivot = new THREE.Vector3(0, 0, 3);
    const anchor = new THREE.Vector3();
    for (let i = 0; i < 12; i += 1) zoomToward(camera, pivot, anchor, 2, 1, 0.8, true);
    expect(camera.z).toBeGreaterThanOrEqual(0.8 - 1e-6);
    expect(camera.z).toBeLessThan(6);
    expect(pivot.z).toBeLessThan(camera.z);
  });

  it('keeps dollying through empty space instead of freezing on the pivot', () => {
    const camera = new THREE.Vector3(0, 0, 0.4);
    const pivot = new THREE.Vector3();
    const before = camera.z;
    zoomToward(camera, pivot, pivot.clone(), 3, 1, 1, false);
    expect(camera.z).toBeLessThan(before);
  });
});

function projectPx(camera: THREE.PerspectiveCamera, point: THREE.Vector3, width: number, height: number): THREE.Vector2 {
  const ndc = point.clone().project(camera);
  return new THREE.Vector2((ndc.x * 0.5 + 0.5) * width, (-ndc.y * 0.5 + 0.5) * height);
}

describe('pan', () => {
  it('matches pointer motion at the pivot depth', () => {
    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 100);
    camera.position.set(0, 2, 10);
    const pivot = new THREE.Vector3(0, 2, 0);
    camera.lookAt(pivot);
    camera.updateMatrixWorld(true);
    const anchor = pivot.clone();
    const fov = 55;
    const height = 800;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const depth = Math.max(anchor.clone().sub(camera.position).dot(forward), 1e-4);
    const worldPerPixel = (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2) * depth) / height;
    panInViewPlane(camera, pivot, fov, height, 20, -10, anchor);
    expect(camera.position.x).toBeCloseTo(-20 * worldPerPixel, 5);
    expect(camera.position.y).toBeCloseTo(2 - 10 * worldPerPixel, 5);
    expect(pivot.x).toBeCloseTo(camera.position.x, 5);
    expect(camera.position.z).toBeCloseTo(10, 5);
  });

  it('keeps an off-axis anchor under the cursor', () => {
    const width = 1280;
    const height = 720;
    const camera = new THREE.PerspectiveCamera(55, width / height, 0.01, 100);
    camera.position.set(0, 0, 0);
    camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(30));
    camera.updateMatrixWorld(true);
    const anchor = new THREE.Vector3(0, 0, -10);
    const pivot = new THREE.Vector3(0, 0, -8);
    const before = projectPx(camera, anchor, width, height);
    panInViewPlane(camera, pivot, 55, height, 37, -21, anchor);
    camera.updateMatrixWorld(true);
    const after = projectPx(camera, anchor, width, height);
    expect(Math.abs(after.x - before.x - 37)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(after.y - before.y - -21)).toBeLessThanOrEqual(0.5);
  });
});

describe('release velocity', () => {
  it('matches 8 ms and 16 ms streams of equal angular speed', () => {
    const speed = 0.4;
    const fast = Array.from({ length: 24 }, () => ({ dtMs: 8, angle: speed * 0.008 }));
    const slow = Array.from({ length: 24 }, () => ({ dtMs: 16, angle: speed * 0.016 }));
    expect(releaseVelocity(fast)).toBeCloseTo(releaseVelocity(slow), 5);
    expect(releaseVelocity(fast)).toBeCloseTo(speed, 2);
  });

  it('matches 35 ms and 70 ms streams of equal angular speed', () => {
    const speed = 0.4;
    const fast = Array.from({ length: 16 }, () => ({ dtMs: 35, angle: speed * 0.035 }));
    const slow = Array.from({ length: 16 }, () => ({ dtMs: 70, angle: speed * 0.07 }));
    expect(releaseVelocity(fast)).toBeCloseTo(releaseVelocity(slow), 5);
  });
});

describe('flat scenes', () => {
  it('treats the drone scan as flat and a cube as not', () => {
    expect(isFlatScene(new THREE.Vector3(590, 490, 77), 'z')).toBe(true);
    expect(isFlatScene(new THREE.Vector3(1, 1, 1), 'y')).toBe(false);
  });

  it('hits the ground plane in front and rejects the other cases', () => {
    const up = new THREE.Vector3(0, 0, 1);
    const origin = new THREE.Vector3(4, 5, 10);
    const hit = groundPlaneHit(origin, new THREE.Vector3(0, 0, -1), up, 0, 100);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeCloseTo(0, 6);
    expect(hit!.x).toBeCloseTo(4, 6);
    expect(groundPlaneHit(origin, new THREE.Vector3(0, 0, 1), up, 0, 100)).toBeNull();
    expect(groundPlaneHit(origin, new THREE.Vector3(1, 0, 0), up, 0, 100)).toBeNull();
    expect(groundPlaneHit(origin, new THREE.Vector3(0, 0, -1), up, 0, 5)).toBeNull();
  });

  it('keeps the current pivot when the pick is empty', () => {
    const current = new THREE.Vector3(1, 2, 3);
    const hit = { point: new THREE.Vector3(9, 9, 9), surface: false, kind: 'none' as const };
    expect(chooseOrbitPivot(hit, current)).toBe(current);
    expect(chooseOrbitPivot({ ...hit, kind: 'ground' }, current)).toBe(hit.point);
  });
});

describe('orbit delta', () => {
  it('follows a fast drag and only clamps capture glitches', () => {
    expect(orbitDelta(120, 0, 1).yaw).toBe(-0.624);
    expect(orbitDelta(400, 0, 1).yaw).toBe(-0.9);
  });

  it('stops a flat orbit just below the horizon and still yaws', () => {
    const polar0 = (80 * Math.PI) / 180;
    const radius = 10;
    const camera = new THREE.Vector3(Math.sin(polar0) * radius, 0, Math.cos(polar0) * radius);
    const pivot = new THREE.Vector3();
    const up = new THREE.Vector3(0, 0, 1);
    const maxPolar = Math.PI / 2 + 0.05;
    for (let i = 0; i < 100; i += 1) orbitAround(camera, pivot, up, 0, -0.05, undefined, maxPolar);
    expect(Math.abs(polarAngle(camera, pivot, up) - maxPolar)).toBeLessThanOrEqual(1e-6);
    const before = camera.clone();
    orbitAround(camera, pivot, up, 0.4, 0, undefined, maxPolar);
    expect(camera.distanceTo(before)).toBeGreaterThan(0.5);
  });
});

describe('wheel smoothing', () => {
  it('delivers one notch at 30 Hz and at 120 Hz', () => {
    const slow = deliveredZoom(30);
    const fast = deliveredZoom(120);
    expect(slow).toBeGreaterThanOrEqual(0.999);
    expect(fast).toBeGreaterThanOrEqual(0.999);
    expect(Math.abs(slow - fast)).toBeLessThan(1e-3);
  });

  it('maps 125 pixels to one notch', () => {
    expect(wheelNotches(125, 0)).toBe(1);
  });
});

function deliveredZoom(hz: number): number {
  let pending = 1;
  let total = 0;
  const dt = 1 / hz;
  const steps = Math.round(0.5 * hz);
  for (let i = 0; i < steps; i += 1) {
    const step = smoothZoomStep(pending, dt, 0.07);
    pending -= step;
    total += step;
  }
  return total;
}

describe('ground pan', () => {
  it('keeps altitude and leaves the anchor on the cursor ray', () => {
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000);
    const up = new THREE.Vector3(0, 0, 1);
    camera.up.copy(up);
    camera.position.set(0, -80, 40);
    const pivot = new THREE.Vector3(0, 0, 0);
    camera.lookAt(pivot);
    camera.updateMatrixWorld(true);
    const anchor = new THREE.Vector3(10, 0, 0);
    const beforeZ = camera.position.z;
    const ndc = anchor.clone().project(camera);
    const cursor = new THREE.Vector3(ndc.x + 0.15, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();
    expect(panOnPlane(camera, pivot, anchor, cursor, up)).toBe(true);
    expect(Math.abs(camera.position.z - beforeZ)).toBeLessThanOrEqual(1e-9);
    const dist = Math.max(anchor.distanceTo(camera.position), 1e-6);
    const along = anchor.clone().sub(camera.position).dot(cursor);
    const closest = camera.position.clone().addScaledVector(cursor, along);
    expect(closest.distanceTo(anchor)).toBeLessThanOrEqual(1e-6 * dist);
  });

  it('rejects a near-horizontal ray', () => {
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.set(0, 0, 10);
    const pivot = new THREE.Vector3();
    const anchor = new THREE.Vector3(0, 0, 0);
    const before = camera.position.clone();
    const ray = new THREE.Vector3(1, 0, -0.05).normalize();
    expect(panOnPlane(camera, pivot, anchor, ray, new THREE.Vector3(0, 0, 1))).toBe(false);
    expect(camera.position.distanceToSquared(before)).toBe(0);
  });
});

describe('coarse surface', () => {
  it('round-trips half floats used by packed splats', () => {
    for (const value of [-12.5, -0.25, 0, 0.5, 3, 77, 590]) {
      expect(halfToFloat(toHalf(value))).toBeCloseTo(value, 1);
    }
  });

  it('samples a 14M cloud down to a fixed budget', () => {
    expect(sampleStride(14_161_020, 24_000)).toBe(Math.ceil(14_161_020 / 24_000));
    expect(Math.ceil(14_161_020 / sampleStride(14_161_020, 24_000))).toBeLessThanOrEqual(24_000);
  });

  it('picks the slab under a ray and stays cheap', () => {
    const count = 20_000;
    const points = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const x = (i % 200) * (590 / 199);
      const y = Math.floor(i / 200) * (490 / 99);
      points[i * 3] = x;
      points[i * 3 + 1] = y;
      points[i * 3 + 2] = 20 + Math.sin(x * 0.02) * 4;
    }
    const started = performance.now();
    const surface = new CoarseSurface(points);
    const origin = new THREE.Vector3(200, 180, 80);
    const hit = surface.pick(origin, new THREE.Vector3(0, 0, -1));
    const elapsed = performance.now() - started;
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeGreaterThan(10);
    expect(hit!.z).toBeLessThan(40);
    expect(Math.abs(hit!.x - 200)).toBeLessThan(30);
    expect(elapsed).toBeLessThan(250);
  });
});
