import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CoarseSurface, sampleStride } from '../src/render/coarseSurface';
import { SplatIndex } from '../src/render/splatIndex';

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
});
