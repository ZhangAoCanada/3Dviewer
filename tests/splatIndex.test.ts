import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CoarseSurface, sampleStride } from '../src/render/coarseSurface';
import { toHalf } from '../src/loaders/gaussian/packSplat';
import { collectIndexSources, gridFor, SplatIndex, SplatIndexJob } from '../src/render/splatIndex';

function planeWithSpike(count: number, spikeIndex: number): Float32Array {
  const positions = new Float32Array(count * 3);
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i += 1) {
    positions[i * 3] = (i % side) * 0.4;
    positions[i * 3 + 1] = Math.floor(i / side) * 0.4;
    positions[i * 3 + 2] = 0;
  }
  // Six centers, so the spike is a supported object. A single center is a floater.
  const cluster = [0, 1, 3, 4, 6, 7];
  for (const offset of cluster) {
    const index = spikeIndex + offset;
    positions[index * 3] = 10 + (offset % 3) * 0.02;
    positions[index * 3 + 1] = 12 + Math.floor(offset / 3) * 0.02;
    positions[index * 3 + 2] = 6;
  }
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

  it('covers every axis of a large flat scene', () => {
    expectCovered(new THREE.Vector3(590, 490, 77), 14_161_020, 1_770_128);
    expectCovered(new THREE.Vector3(5000, 10, 10), 2e6, 2e6 / 8);
    expectCovered(new THREE.Vector3(1, 1, 1), 100, 4096);
  });

  it('picks the far corner of a 590 by 490 metre grid', () => {
    const columns = 296;
    const rows = 246;
    const positions = new Float32Array((columns * rows + 1) * 3);
    let cursor = 0;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        positions[cursor++] = x * 2;
        positions[cursor++] = y * 2;
        positions[cursor++] = 0;
      }
    }
    positions[cursor++] = 0;
    positions[cursor++] = 0;
    positions[cursor++] = 77;
    const index = SplatIndex.fromPositions(positions, undefined, 1_770_128);
    const hit = pickAt(index, 585, 485, 200);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.z)).toBeLessThanOrEqual(0.05);
  });

  it('lands on the slab instead of one floater', () => {
    const positions = withExtra(gridPoints(200, 200, 0.5, 0), [[0, 0, 20]]);
    const hit = pickAt(SplatIndex.fromPositions(positions), 0, 0, 100);
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.z)).toBeLessThanOrEqual(0.05);
  });

  it('keeps a tight blob that is actually supported', () => {
    const blob: number[][] = [
      [0, 0, 20],
      [0.02, 0, 20],
      [-0.02, 0, 20],
      [0, 0.02, 20],
      [0, -0.02, 20],
      [0.02, 0.02, 20],
    ];
    const positions = withExtra(gridPoints(200, 200, 0.5, 0), blob);
    const hit = pickAt(SplatIndex.fromPositions(positions), 0, 0, 100);
    expect(hit).not.toBeNull();
    expect(hit!.z).toBeCloseTo(20, 1);
  });

  it('skips a floater whose opacity is below 0.1 even with support of 1', () => {
    const slab = 200;
    const packed = new Uint32Array((slab * slab + 1) * 4);
    let index = 0;
    for (let y = 0; y < slab; y += 1) {
      for (let x = 0; x < slab; x += 1) {
        writePackedCenter(packed, index, x * 0.5, y * 0.5, 0, 255);
        index += 1;
      }
    }
    writePackedCenter(packed, index, 0, 0, 20, 10);
    const built = SplatIndex.fromPacked(packed);
    const origin = new THREE.Vector3(0, 0, 100);
    const direction = new THREE.Vector3(0, 0, -1);
    const target = new THREE.Vector3();
    expect(built.pick(origin, direction, direction, THREE.MathUtils.degToRad(55), 900, target, 1)).toBe(true);
    expect(Math.abs(target.z)).toBeLessThanOrEqual(0.05);
  });

  it('advances one 8000-splat chunk on a 0.01 ms pump', () => {
    const count = 1_000_000;
    const positions = new Float32Array(count * 3);
    const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
    const job = SplatIndexJob.fromPositions(positions, box);
    expect(job.pump(0.01)).toBe(false);
    expect(job.progress).toBe(8000 / (2 * 1e6));
  });
});

function expectCovered(size: THREE.Vector3, count: number, maxCells: number): void {
  const grid = gridFor(size, count);
  expect(grid.nx * grid.cell).toBeGreaterThanOrEqual(size.x);
  expect(grid.ny * grid.cell).toBeGreaterThanOrEqual(size.y);
  expect(grid.nz * grid.cell).toBeGreaterThanOrEqual(size.z);
  expect(grid.nx * grid.ny * grid.nz).toBeLessThanOrEqual(maxCells);
  expect(grid.nx).toBeLessThanOrEqual(1024);
  expect(grid.ny).toBeLessThanOrEqual(1024);
  expect(grid.nz).toBeLessThanOrEqual(1024);
}

function gridPoints(columns: number, rows: number, spacing: number, z: number): Float32Array {
  const positions = new Float32Array(columns * rows * 3);
  let cursor = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      positions[cursor++] = x * spacing;
      positions[cursor++] = y * spacing;
      positions[cursor++] = z;
    }
  }
  return positions;
}

function withExtra(base: Float32Array, extra: number[][]): Float32Array {
  const positions = new Float32Array(base.length + extra.length * 3);
  positions.set(base);
  let cursor = base.length;
  for (const point of extra) {
    positions[cursor++] = point[0] ?? 0;
    positions[cursor++] = point[1] ?? 0;
    positions[cursor++] = point[2] ?? 0;
  }
  return positions;
}

function writePackedCenter(packed: Uint32Array, index: number, x: number, y: number, z: number, alpha: number): void {
  const o = index * 4;
  packed[o] = (alpha & 255) << 24;
  packed[o + 1] = toHalf(x) | (toHalf(y) << 16);
  packed[o + 2] = toHalf(z);
}

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
