import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blobSource } from '../src/core/byteSource';
import { SAMPLES } from '../src/core/samples';
import { classifyPly, extensionOf, headerText, isGlbMagic, sniffGaussian, sniffMesh, sniffPoints } from '../src/core/sniff';
import type { AssetSource } from '../src/core/types';
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

  it('records the real file size, a small thumbnail, and the sniffed kind', () => {
    const root = join(process.cwd(), 'public');
    for (const sample of SAMPLES) {
      expect(sample.title.length).toBeGreaterThan(0);
      if (sample.remote) {
        expect(sample.bytes).toBeUndefined();
        expect(sample.thumb).toBeUndefined();
        expect(sample.kind).toBe('splats');
        continue;
      }
      const file = join(root, sample.href);
      expect(sample.bytes).toBe(statSync(file).size);
      expect(sample.thumb).toBeTruthy();
      const thumb = join(root, sample.thumb ?? '');
      expect(statSync(thumb).size).toBeLessThan(16 * 1024);
      const header = new Uint8Array(readFileSync(file).subarray(0, 65536));
      const source: AssetSource = { name: sample.href, extension: extensionOf(sample.href), origin: 'sample' };
      const sniffed = sniffGaussian(source, header)
        ? 'splats'
        : sniffPoints(source, header)
          ? 'points'
          : sniffMesh(source, header)
            ? 'mesh'
            : null;
      expect(sample.kind).toBe(sniffed);
    }
  });
});
