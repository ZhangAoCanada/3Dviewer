import { describe, expect, it } from 'vitest';
import type { MemoryBudget } from '../src/core/types';
import type { DecodedGaussian } from '../src/loaders/gaussian/decodeGaussianPly';
import { handleDecodeRequest } from '../src/workers/gaussianPly.worker';

const budget: MemoryBudget = {
  profile: 'desktop',
  cpuBytes: 64 * 1024 * 1024,
  maxPoints: 1_000,
  maxSplatsResident: 1_000,
  maxSh: 0,
  pixelRatioCap: 1,
};

describe('handleDecodeRequest', () => {
  it('round-trips GaussianPlyError.name onto the error message', async () => {
    const posts: { type: string; message?: string; name?: string }[] = [];
    await handleDecodeRequest({ blob: new Blob(['ply\nformat binary_little_endian 1.0\n']), budget, preferExtended: false }, (message) => {
      posts.push(message);
    });
    const posted = posts.find((message) => message.type === 'error');
    expect(posted?.name).toBe('GaussianPlyError');
    const error = new Error(posted?.message || 'Gaussian decode failed');
    if (posted?.name) error.name = posted.name;
    expect(error.name).toBe('GaussianPlyError');
    expect(error.message).toMatch(/end_header/);
  });

  it('round-trips precisionReduced across the worker result', async () => {
    const tiny: MemoryBudget = {
      profile: 'desktop',
      cpuBytes: 64 * 1024,
      maxPoints: 100,
      maxSplatsResident: 100,
      maxSh: 3,
      pixelRatioCap: 1,
    };
    const reduced = await posted({ blob: gaussianBlob(2), budget: tiny, preferExtended: true });
    expect(reduced.precisionReduced).toBe(true);
    expect(structuredClone(reduced).precisionReduced).toBe(true);

    const kept = await posted({ blob: gaussianBlob(1), budget, preferExtended: false });
    expect(kept.precisionReduced).toBe(false);
    expect(structuredClone(kept).precisionReduced).toBe(false);
  });
});

function posted(request: { blob: Blob; budget: MemoryBudget; preferExtended: boolean }): Promise<DecodedGaussian> {
  return new Promise((resolve, reject) => {
    void handleDecodeRequest(request, (message) => {
      if (message.type === 'result' && message.data) resolve(message.data);
      else if (message.type === 'error') reject(new Error(message.message));
    }).catch(reject);
  });
}

function gaussianBlob(count: number): Blob {
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  for (let i = 0; i < 45; i += 1) props.push(`f_rest_${i}`);
  props.push('opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3');
  const header = Buffer.from(
    ['ply', 'format binary_little_endian 1.0', `element vertex ${count}`, ...props.map((name) => `property float ${name}`), 'end_header', ''].join(
      '\n',
    ),
  );
  const body = Buffer.alloc(count * props.length * 4);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const fdc = (channel: number) => ((channel === 0 ? 1 : 0) - 0.5) / 0.28209479177387814;
  for (let i = 0; i < count; i += 1) {
    const values = new Array<number>(props.length).fill(0);
    values[0] = 1;
    values[1] = 0.25;
    values[2] = -1;
    values[6] = fdc(0);
    values[7] = fdc(1);
    values[8] = fdc(2);
    values[54] = 0;
    values[58] = 1;
    for (let p = 0; p < values.length; p += 1) view.setFloat32(i * props.length * 4 + p * 4, values[p] ?? 0, true);
  }
  return new Blob([header, body]);
}
