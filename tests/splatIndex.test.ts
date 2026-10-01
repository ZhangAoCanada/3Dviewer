import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CoarseSurface, sampleStride } from '../src/render/coarseSurface';
import { collectIndexSources, SplatIndex, SplatIndexJob } from '../src/render/splatIndex';

function planeWithSpike(count: number, spikeIndex: number): Float32Array {
  const positions = new Float32Array(count * 3);
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (i % side) * 0.4;
    positions[i * 3 + 1] = Math.floor(i / side) * 0.4;
    positions[i * 3 + 2] = 0;
  }
  positions[spikeIndex * 3] = 10;
  positions[spikeIndex * 3 + 1] = 12;
  positions[spikeIndex * 3 + 2] = 6;
  return positions;
}

function pickAt(index: SplatIndex, x: number, y: number, z: number): THREE.Vector3 | null {
  const origin = new THREE.Vector3(x, y, z);
  const direction = new THREE.Vector3(0, 0, -1);
  const forward = direction.clone();
  const target = new THREE.Vector3();
  const hit = index.pick(origin, direction, forward, THREE.MathUtils.degToRad(55), 900, target);
  return hit ? target : null;
}

describe('splat index', () => {
  it('puts the pivot on the ray at the spike, which a 24k stride sample misses', () => {
    const count = 50_000;
    const spike = 1;
    const positions = planeWithSpike(count, spike);
    const index = SplatIndex.fromPositions(positions);
    const hit = pickAt(index, 10, 12, 30);
    expect(hit).not.toBeNull();
    expect(hit!.x).toBeCloseTo(10, 5);
    expect(hit!.y).toBeCloseTo(12, 5);
    expect(hit!.z).toBeCloseTo(6, 1);

    const stride = sampleStride(count, 24_000);
    const sampled: number[] = [];
    for (let i = 0; i < count; i += stride) sampled.push(positions[i * 3]!, positions[i * 3 + 1]!, positions[i * 3 + 2]!);
    const coarse = new CoarseSurface(Float32Array.from(sampled));
    const coarseHit = coarse.pick(new THREE.Vector3(10, 12, 30), new THREE.Vector3(0, 0, -1));
    expect(stride).toBeGreaterThan(1);
    expect(spike % stride).not.toBe(0);
    expect(coarseHit === null || Math.abs((coarseHit?.z ?? 0) - 6) > 1).toBe(true);
  });

  it('keeps the center under the pixel when a neighbor sits closer', () => {
    const positions = new Float32Array([
      0.08, 0, 9,
      0, 0, 8.5,
      0, 0, 2,
    ]);
    const index = SplatIndex.fromPositions(positions);
    const hit = pickAt(index, 0, 0, 20);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeCloseTo(8.5, 1);

    const background = new Float32Array([0.08, 0, 9, 0, 0, 2]);
    const far = SplatIndex.fromPositions(background);
    const farHit = pickAt(far, 0, 0, 20);
    expect(farHit).not.toBeNull();
    expect(farHit!.z).toBeCloseTo(2, 1);
  });

  it('keeps the nearer surface when two layers lie on the ray', () => {
    const positions = new Float32Array([0, 0, 2, 0, 0, 9, 4, 4, 2]);
    const index = SplatIndex.fromPositions(positions);
    const hit = pickAt(index, 0, 0, 20);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeCloseTo(9, 1);
    expect(hit!.z).toBeGreaterThan(2);
  });

  it('picks a 40k cloud without a hitch', () => {
    const count = 40_000;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = (i % 200) * 0.5;
      positions[i * 3 + 1] = Math.floor(i / 200) * 0.5;
      positions[i * 3 + 2] = 4 + Math.sin(i) * 0.2;
    }
    const started = performance.now();
    const index = SplatIndex.fromPositions(positions);
    const hit = pickAt(index, 20, 15, 30);
    const elapsed = performance.now() - started;
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeGreaterThan(3);
    expect(hit!.z).toBeLessThan(6);
    expect(elapsed).toBeLessThan(80);
  });

  it('caps a 1M cube at 125k cells and matches brute force within 1 px', () => {
    const count = 1_000_000;
    const positions = new Float32Array(count * 3);
    let seed = 1;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < count; i += 1) {
      positions[i * 3] = rand();
      positions[i * 3 + 1] = rand();
      positions[i * 3 + 2] = rand();
    }
    const index = SplatIndex.fromPositions(positions);
    expect(index.cells).toBeLessThanOrEqual(125_000);

    const origin = new THREE.Vector3(0.5, 0.5, 3);
    const direction = new THREE.Vector3(0, 0, -1);
    const fov = THREE.MathUtils.degToRad(55);
    const height = 900;
    const target = new THREE.Vector3();
    expect(index.pick(origin, direction, direction, fov, height, target)).toBe(true);
    const brute = bruteRayPoint(positions, origin, direction, fov, height);
    expect(brute).not.toBeNull();
    const depth = Math.max(target.distanceTo(origin), 1e-3);
    const worldPerPixel = (2 * Math.tan(fov / 2) * depth) / height;
    expect(target.distanceTo(brute!) / worldPerPixel).toBeLessThanOrEqual(1);
  }, 30_000);

  it('picks a source translated to 4.5e6 within 1e-3', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
    const points = new THREE.Points(geometry);
    points.position.set(4.5e6, 0, 0);
    const group = new THREE.Group();
    group.add(points);
    const sources = collectIndexSources(group);
    const box = new THREE.Box3().setFromObject(points);
    const job = new SplatIndexJob(sources, box);
    expect(job.pump(1e9)).toBe(true);
    const index = job.finish();
    expect(index).not.toBeNull();
    const origin = new THREE.Vector3(4.5e6, 0, 10);
    const direction = new THREE.Vector3(0, 0, -1);
    const target = new THREE.Vector3();
    expect(index!.pick(origin, direction, direction, THREE.MathUtils.degToRad(55), 900, target)).toBe(true);
    expect(Math.abs(target.x - 4.5e6)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(target.y)).toBeLessThanOrEqual(1e-3);
    expect(Math.abs(target.z)).toBeLessThanOrEqual(1e-3);
  });
});

function bruteRayPoint(
  positions: Float32Array,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  fov: number,
  viewHeight: number,
): THREE.Vector3 | null {
  const len = direction.length();
  const dirX = direction.x / len;
  const dirY = direction.y / len;
  const dirZ = direction.z / len;
  const pixelScale = (2 * Math.tan(fov / 2)) / Math.max(1, viewHeight);
  let bestNear = Infinity;
  let bestFar = Infinity;
  const count = positions.length / 3;
  for (let i = 0; i < count; i += 1) {
    const vx = (positions[i * 3] ?? 0) - origin.x;
    const vy = (positions[i * 3 + 1] ?? 0) - origin.y;
    const vz = (positions[i * 3 + 2] ?? 0) - origin.z;
    const t = vx * dirX + vy * dirY + vz * dirZ;
    if (t < 1e-3) continue;
    const perpX = vx - dirX * t;
    const perpY = vy - dirY * t;
    const perpZ = vz - dirZ * t;
    const perp2 = perpX * perpX + perpY * perpY + perpZ * perpZ;
    const worldPerPixel = pixelScale * Math.max(1e-3, t);
    if (perp2 <= (worldPerPixel * 3.5) ** 2 && t < bestNear) bestNear = t;
    if (perp2 <= (worldPerPixel * 14) ** 2 && t < bestFar) bestFar = t;
  }
  const t = Number.isFinite(bestNear) ? bestNear : bestFar;
  if (!Number.isFinite(t)) return null;
  return new THREE.Vector3(origin.x + dirX * t, origin.y + dirY * t, origin.z + dirZ * t);
}
