import { bench, describe } from 'vitest';
import { blobSource } from '../../src/core/byteSource';
import { decodeGaussianPly } from '../../src/loaders/gaussian/decodeGaussianPly';

/** Synthetic INRIA SH3 cloud. Not part of `npm test` (`vitest run` ignores `*.bench.ts`). */
const COUNT = 500_000;
const STRIDE = 248;

function gaussianHeader(count: number): string {
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  for (let i = 0; i < 45; i += 1) props.push(`f_rest_${i}`);
  props.push('opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3');
  return `ply\nformat binary_little_endian 1.0\nelement vertex ${count}\n${props.map((name) => `property float ${name}`).join('\n')}\nend_header\n`;
}

function syntheticSh3(): Blob {
  const header = Buffer.from(gaussianHeader(COUNT));
  const body = Buffer.alloc(COUNT * STRIDE);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  for (let i = 0; i < COUNT; i += 1) {
    const offset = i * STRIDE;
    view.setFloat32(offset, i * 0.01, true);
    view.setFloat32(offset + 4, 0.25, true);
    view.setFloat32(offset + 8, -1, true);
    view.setFloat32(offset + 58 * 4, 1, true);
  }
  return new Blob([header, body]);
}

const blob = syntheticSh3();
const budget = {
  profile: 'desktop' as const,
  cpuBytes: 2 * 1024 * 1024 * 1024,
  maxPoints: 8_000_000,
  maxSplatsResident: 2_500_000,
  maxSh: 3 as const,
  pixelRatioCap: 2,
};

describe('decode 500k SH3', () => {
  bench(
    'packed SH3',
    async () => {
      const decoded = await decodeGaussianPly(blobSource(blob), { budget, preferExtended: false });
      if (decoded.count !== COUNT) throw new Error(`decoded ${decoded.count}, expected ${COUNT}`);
    },
    { warmupIterations: 0, warmupTime: 0, iterations: 1, time: 0 },
  );
});
