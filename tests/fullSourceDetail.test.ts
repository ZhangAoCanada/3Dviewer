import { describe, expect, it } from 'vitest';
import { blobSource } from '../src/core/byteSource';
import { classifyFailure } from '../src/core/loadFailure';
import { FullSourceDetailError, shReductionText } from '../src/core/sourceDetail';
import { detectMemoryBudget } from '../src/core/memoryBudget';
import { resolvePreset, mergePresetOverrides } from '../src/core/qualityPreset';
import { decodeGaussianPly } from '../src/loaders/gaussian/decodeGaussianPly';
import { planGaussianDecode } from '../src/loaders/gaussian/gaussianPlan';
import { handleDecodeRequest } from '../src/workers/gaussianPly.worker';
import { gaussianPlyFixture } from './fixtures/gaussianPlyFixture';

const desktop = detectMemoryBudget({ userAgent: 'Desktop', deviceMemory: 8 });
// Deliberately small policy budget, NOT a pretend GPU or a hardware detection claim.
const tiny = { ...desktop, cpuBytes: 230_000 };
const full = resolvePreset('quality', tiny, 'full');

describe('explicit full source detail', () => {
  it('keeps the real SH3 bands/count/float32 centers instead of the same fixture at SH2', async () => {
    const bytes = gaussianPlyFixture(); const original = Buffer.from(bytes);
    const source = blobSource(new Blob([bytes]));
    const safe = await decodeGaussianPly(source, { budget: tiny, preferExtended: true });
    expect([safe.sourceSh, safe.shDegree, safe.count, safe.extended]).toEqual([3, 2, 8, true]);
    expect(safe.sh3).toBeUndefined();
    for (const little of [true, false]) {
      const decoded = await decodeGaussianPly(blobSource(new Blob([gaussianPlyFixture({ little })])), { budget: tiny, preferExtended: false, overrides: full.overrides });
      expect([decoded.sourceSh, decoded.shDegree, decoded.sourceCount, decoded.count, decoded.stride, decoded.extended, decoded.precisionReduced, decoded.lod]).toEqual([3, 3, 8, 8, 1, true, false, false]);
      expect(decoded.decodedBytes).toBe(196_608);
      expect(decoded.sh3?.slice(0, 4).every((v) => v !== 0)).toBe(true);
      expect(decoded.sh3b?.slice(0, 3).every((v) => v !== 0)).toBe(true);
    }
    expect(bytes).toEqual(original);
  });

  it.each([0, 1, 2, 3] as const)('preserves exact supported source SH%s without inventing missing bands', async (degree) => {
    const decoded = await decodeGaussianPly(blobSource(new Blob([gaussianPlyFixture({ degree })])), { budget: tiny, preferExtended: false, overrides: full.overrides });
    expect([decoded.sourceSh, decoded.shDegree, decoded.count, decoded.extended]).toEqual([degree, degree, 8, true]);
  });

  it('reports source SH4 truthfully and refuses Full instead of labeling SH3 as full', async () => {
    const source = blobSource(new Blob([gaussianPlyFixture({ degree: 4 })]));
    const safe = await decodeGaussianPly(source, { budget: desktop, preferExtended: true });
    expect([safe.sourceSh, safe.shDegree]).toEqual([4, 3]);
    await expect(decodeGaussianPly(source, { budget: desktop, preferExtended: true, overrides: full.overrides })).rejects.toThrow(/source SH 4/);
  });

  it('bypasses all soft caps, not just the SH slider or desktop budget', () => {
    const budget = { ...tiny, profile: 'mobile' as const, maxSplatsResident: 1, maxSh: 0 as const };
    const plan = planGaussianDecode({ sourceCount: 8, sourceSh: 3, budget, preferExtended: false, overrides: { fullDetail: true, maxSh: 0, forceLod: true } });
    expect([plan.decodedCount, plan.stride, plan.shDegree, plan.extended, plan.lod]).toEqual([8, 1, 3, true, false]);
    expect(mergePresetOverrides('quality', full, { maxSh: 2, forceLod: true })).toEqual({ fullDetail: true });
    expect(resolvePreset('auto', desktop).overrides).toBeUndefined();
  });

  it('plans the reported 14,161,020-splat case at source SH3, without allocating a giant scene', () => {
    const args = { sourceCount: 14_161_020, sourceSh: 3 as const, budget: desktop, preferExtended: true };
    expect(planGaussianDecode(args).shDegree).toBe(2);
    const plan = planGaussianDecode({ ...args, overrides: { fullDetail: true } });
    expect([plan.shDegree, plan.decodedCount, plan.extended, plan.estimatedBytes]).toEqual([3, 14_161_020, true, 1_610_612_736]);
  });

  it.each([{ maxTextureSize: 1024, maxArrayTextureLayers: 256 }, { maxTextureSize: 4096, maxArrayTextureLayers: 0 }])('refuses actual WebGL dimension limits before allocation: %j', async (textureLimits) => {
    await expect(decodeGaussianPly(blobSource(new Blob([gaussianPlyFixture()])), { budget: tiny, preferExtended: true, overrides: full.overrides, textureLimits })).rejects.toThrow(/WebGL allows/);
  });

  it('accounts for the 8,388,608 splat texture-padding cliff, without allocating it', () => {
    const plan = (sourceCount: number) => planGaussianDecode({ sourceCount, sourceSh: 3, budget: desktop, preferExtended: true, overrides: full.overrides });
    expect(plan(8_388_608).estimatedBytes).toBe(805_306_368);
    expect(plan(8_388_609).estimatedBytes).toBe(1_207_959_552);
  });

  it('surfaces the exact Full blocker through the normal failure UI, including worker-shaped errors', () => {
    const error = new FullSourceDetailError('Source SH4 cannot be preserved by this SH0–3 renderer.');
    const transferred = new Error(error.message);transferred.name = error.name;
    expect(classifyFailure(transferred).body).toBe(error.message);
  });

  it('rejects unrepresentable indexing and invalid counts rather than decimating Full', () => {
    for (const sourceCount of [2 ** 32, Infinity, Number.NaN, -1]) expect(() => planGaussianDecode({ sourceCount, sourceSh: 3, budget: desktop, preferExtended: true, overrides: full.overrides })).toThrow();
  });

  it('does not adopt a reduced Full scene when source records are invalid', async () => {
    const bytes = gaussianPlyFixture();const headerEnd = bytes.indexOf('end_header\n') + 'end_header\n'.length;
    bytes.writeFloatLE(Number.NaN, headerEnd);
    await expect(decodeGaussianPly(blobSource(new Blob([bytes])), { budget: tiny, preferExtended: true, overrides: full.overrides })).rejects.toThrow(/No reduced scene was adopted/);
  });

  it('passes the policy and actual texture limits through the worker protocol', async () => {
    const results: string[] = [];
    await handleDecodeRequest({ blob: new Blob([gaussianPlyFixture()]), budget: tiny, preferExtended: false, overrides: full.overrides, textureLimits: { maxTextureSize: 4096, maxArrayTextureLayers: 256 } }, (m) => {
      if (m.type === 'result') { expect([m.data.shDegree, m.data.count, m.data.extended]).toEqual([3, 8, true]); results.push('result'); }
      if (m.type === 'error') throw new Error(m.message);
    });
    expect(results).toEqual(['result']);
  });
});


describe('recorded SH load-reduction provenance', () => {
  const cases = [
    { name: 'explicit cap with ample budget', budget: desktop, overrides: { maxSh: 2 as const }, degree: 2, reason: 'request' },
    { name: 'real buffer-budget step-down', budget: tiny, overrides: undefined, degree: 2, reason: 'budget' },
    { name: 'budget cap stricter than explicit cap', budget: { ...desktop, maxSh: 1 as const }, overrides: { maxSh: 2 as const }, degree: 1, reason: 'budget' },
    { name: 'explicit cap stricter than budget cap', budget: { ...desktop, maxSh: 2 as const }, overrides: { maxSh: 1 as const }, degree: 1, reason: 'request' },
    { name: 'buffer step-down below explicit cap', budget: { ...desktop, cpuBytes: 80_000 }, overrides: { maxSh: 2 as const }, degree: 1, reason: 'budget' },
    { name: 'source-equivalent cap is not blamed for further budget step-down', budget: tiny, overrides: { maxSh: 3 as const }, degree: 2, reason: 'budget' },
  ];
  it.each(cases)('$name', async ({ budget, overrides, degree, reason }) => {
    const decoded = await decodeGaussianPly(blobSource(new Blob([gaussianPlyFixture()])), { budget, preferExtended: true, overrides });
    expect([decoded.sourceSh, decoded.shDegree, decoded.count, decoded.shReduction]).toEqual([3, degree, 8, reason]);
    expect(decoded.notes).toContain(shReductionText(degree, 3, decoded.shReduction));
    if (reason === 'request') expect(decoded.notes.join(' ')).not.toContain('fit memory');
  });
  it('carries requested-cap evidence through the production worker response', async () => {
    let seen = false;
    await handleDecodeRequest({ blob: new Blob([gaussianPlyFixture()]), budget: desktop, preferExtended: false, overrides: { maxSh: 2 } }, (message) => {
      if (message.type === 'error') throw new Error(message.message);
      if (message.type === 'result') { seen = true;expect(message.data.shReduction).toBe('request');expect(message.data.notes.join(' ')).toContain('requested load cap'); }
    });
    expect(seen).toBe(true);
  });
});
