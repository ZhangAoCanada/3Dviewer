import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blobSource } from '../src/core/byteSource';
import { classifyPly, headerText, isGlbMagic } from '../src/core/sniff';
import { parsePlyPoints } from '../src/loaders/points/parsePly';

const samples = join(process.cwd(), 'public', 'samples');

describe('bundled samples', () => {
  it('ships a gaussian ply, a point cloud, a splat, an obj, and a glb', async () => {
    const gaussian = readFileSync(join(samples, 'torus.ply'));
    const cloud = readFileSync(join(samples, 'cloud.ply'));
    const splat = readFileSync(join(samples, 'torus.splat'));
    const obj = readFileSync(join(samples, 'sphere.obj'), 'utf8');
    const glb = readFileSync(join(samples, 'crate.glb'));
    expect(classifyPly(headerText(gaussian))).toBe('gaussian');
    expect(classifyPly(headerText(cloud))).toBe('points');
    expect(splat.byteLength % 32).toBe(0);
    expect(splat.byteLength).toBeGreaterThan(32 * 1000);
    expect(obj.startsWith('#') || obj.includes('\nv ')).toBe(true);
    expect(isGlbMagic(glb.subarray(0, 4))).toBe(true);
    const parsed = await parsePlyPoints(blobSource(new Blob([cloud])), 5000);
    expect(parsed.sourceCount).toBe(24000);
    expect(parsed.count).toBeLessThanOrEqual(5000);
    expect(parsed.colors?.[0]).toBeGreaterThan(0);
  });
});
