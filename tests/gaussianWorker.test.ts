import { describe, expect, it } from 'vitest';
import type { MemoryBudget } from '../src/core/types';
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
});
