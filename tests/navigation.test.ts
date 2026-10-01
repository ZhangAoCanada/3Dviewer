import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { detectUpAxis, orbitAround, panInViewPlane, polarAngle, zoomToward } from '../src/render/cameraMotion';
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
});

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

describe('pan', () => {
  it('matches pointer motion at the pivot depth', () => {
    const camera = new THREE.Vector3(0, 2, 10);
    const pivot = new THREE.Vector3(0, 2, 0);
    const fov = 55;
    const height = 800;
    const depth = camera.distanceTo(pivot);
    const worldPerPixel = (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2) * depth) / height;
    panInViewPlane(camera, pivot, new THREE.Vector3(0, 1, 0), fov, height, 20, -10, depth);
    expect(camera.x).toBeCloseTo(-20 * worldPerPixel, 5);
    expect(camera.y).toBeCloseTo(2 - 10 * worldPerPixel, 5);
    expect(pivot.x).toBeCloseTo(camera.x, 5);
    expect(camera.z).toBeCloseTo(10, 5);
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
