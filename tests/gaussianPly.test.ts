import { describe, expect, it } from 'vitest';
import { blobSource, type ByteSource } from '../src/core/byteSource';
import { detectMemoryBudget } from '../src/core/memoryBudget';
import { decodeGaussianPly, resolveVertexCount } from '../src/loaders/gaussian/decodeGaussianPly';
import { explainLoadError } from '../src/loaders/gaussian/explainLoadError';
import { planGaussianDecode, estimateDecodedBytes, LOD_ABOVE } from '../src/loaders/gaussian/gaussianPlan';
import { toHalf, writePackedSplat, DEFAULT_LIMITS } from '../src/loaders/gaussian/packSplat';
import { halfToFloat } from '../src/render/coarseSurface';

const SH_C0 = 0.28209479177387814;

function gaussianHeader(count: number, comments: string[] = []): string {
  const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
  for (let i = 0; i < 45; i += 1) props.push(`f_rest_${i}`);
  props.push('opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3');
  const lines = [
    'ply',
    'format binary_little_endian 1.0',
    ...comments.map((comment) => `comment ${comment}`),
    `element vertex ${count}`,
    ...props.map((name) => `property float ${name}`),
    'end_header',
  ];
  return `${lines.join('\n')}\n`;
}

function writeSplat(view: DataView, offset: number, x: number, rest0 = 0, y = 0.25, z = -1): void {
  const fdc = (channel: number) => ((channel === 0 ? 1 : 0) - 0.5) / SH_C0;
  const values = new Array<number>(62).fill(0);
  values[0] = x;
  values[1] = y;
  values[2] = z;
  values[6] = fdc(0);
  values[7] = fdc(1);
  values[8] = fdc(2);
  values[9] = rest0;
  values[54] = 0;
  values[55] = 0;
  values[56] = 0;
  values[57] = 0;
  values[58] = 1;
  values[59] = 0;
  values[60] = 0;
  values[61] = 0;
  for (let i = 0; i < 62; i += 1) view.setFloat32(offset + i * 4, values[i] ?? 0, true);
}

function gaussianBlob(bodyCount: number, headerCount: number, comments: string[] = [], rest0 = 0): Blob {
  const header = Buffer.from(gaussianHeader(headerCount, comments));
  const body = Buffer.alloc(bodyCount * 248);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  for (let i = 0; i < bodyCount; i += 1) writeSplat(view, i * 248, i + 1, rest0);
  return new Blob([header, body]);
}

const desktop = {
  profile: 'desktop' as const,
  cpuBytes: 512 * 1024 * 1024,
  maxPoints: 8_000_000,
  maxSplatsResident: 2_500_000,
  maxSh: 3 as const,
  pixelRatioCap: 2,
};

describe('resolveVertexCount', () => {
  it('trusts the body when the owner file stride divides it exactly', () => {
    const resolved = resolveVertexCount(17168, 2041, 3_511_935_001, 248);
    expect(resolved).toEqual({ count: 14_161_020, mismatch: true });
    expect((3_511_935_001 - 2041) % 248).toBe(0);
  });

  it('keeps the header count when the body has a remainder and the header fits', () => {
    expect(resolveVertexCount(4, 100, 100 + 4 * 248 + 12, 248)).toEqual({ count: 4, mismatch: false });
  });

  it('rejects a truncated body that matches neither count', () => {
    expect(() => resolveVertexCount(100, 50, 50 + 10, 248)).toThrow(/does not fit/);
  });
});

describe('decodeGaussianPly', () => {
  it('loads the body splat count when the header count is wrong', async () => {
    const blob = gaussianBlob(5, 2, ['offsetx 539022.51', 'offsety 3377206.74', 'offsetz 22.95', 'epsg 4547'], 0.5);
    const decoded = await decodeGaussianPly(blobSource(blob), {
      budget: desktop,
      preferExtended: false,
      chunkBytes: 500,
    });
    expect(decoded.count).toBe(5);
    expect(decoded.sourceCount).toBe(5);
    expect(decoded.headerCount).toBe(2);
    expect(decoded.mismatch).toBe(true);
    expect(decoded.stride).toBe(1);
    expect(decoded.shDegree).toBe(3);
    expect(decoded.warning).toMatch(/header says 2/);
    expect(decoded.warning).toMatch(/holds 5/);
    expect(decoded.georef.offsetX).toBe('539022.51');
    expect(decoded.georef.offsetY).toBe('3377206.74');
    expect(decoded.georef.offsetZ).toBe('22.95');
    expect(decoded.georef.epsg).toBe('4547');
    const packed = decoded.packedArray;
    expect(packed).toBeTruthy();
    expect(packed![0]! & 255).toBe(255);
    expect((packed![0]! >>> 8) & 255).toBe(0);
    expect(packed![5]! & 65535).toBe(toHalf(2 - decoded.origin[0]));
    expect(decoded.sh1?.some((word) => word !== 0)).toBe(true);
  });

  it('does not warn when the header count matches the body', async () => {
    const decoded = await decodeGaussianPly(blobSource(gaussianBlob(3, 3)), {
      budget: desktop,
      preferExtended: false,
      chunkBytes: 248,
    });
    expect(decoded.count).toBe(3);
    expect(decoded.mismatch).toBe(false);
    expect(decoded.warning).toBeUndefined();
    expect(decoded.packedArray![9]! & 65535).toBe(toHalf(3 - decoded.origin[0]));
  });

  it('keeps robust bounds inside the cloud when a few floaters sit at 1e4', async () => {
    const count = 10_010;
    const header = Buffer.from(gaussianHeader(count));
    const body = Buffer.alloc(count * 248);
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    for (let i = 0; i < 10_000; i += 1) {
      const t = i / 9999;
      writeSplat(view, i * 248, t, 0, (i % 100) / 99, (i % 50) / 49);
    }
    for (let i = 0; i < 10; i += 1) writeSplat(view, (10_000 + i) * 248, 1e4, 0, 1e4, 1e4);
    const decoded = await decodeGaussianPly(blobSource(new Blob([header, body])), {
      budget: desktop,
      preferExtended: false,
    });
    expect(decoded.count).toBe(count);
    expect(decoded.robustBounds.max[0]).toBeLessThan(2);
    expect(decoded.bounds.max[0]).toBeCloseTo(1e4, -2);
  });

  it('drops a splat whose center is NaN', async () => {
    const decoded = await decodeGaussianPly(blobSource(gaussianBlobAt([1, Number.NaN, 3, 4])), {
      budget: desktop,
      preferExtended: false,
    });
    expect(decoded.count).toBe(3);
    expect(decoded.notes.join(' ')).toMatch(/non-finite/);
  });

  it('keeps a packed center at x = 70000 finite after adding the origin back', async () => {
    const decoded = await decodeGaussianPly(blobSource(gaussianBlobAt([70_000, 70_000])), {
      budget: desktop,
      preferExtended: false,
    });
    const local = halfToFloat(decoded.packedArray![1]! & 65535);
    expect(Number.isFinite(local)).toBe(true);
    expect(local + decoded.origin[0]).toBeCloseTo(70_000);
  });

  it('quantizes an SH1 coefficient of 0.03 to within 0.01', async () => {
    const decoded = await decodeGaussianPly(blobSource(gaussianBlob(1, 1, [], 0.03)), {
      budget: desktop,
      preferExtended: false,
    });
    const word = decoded.sh1?.[0] ?? 0;
    const raw = word & 127;
    const signed = (raw & 64) !== 0 ? raw - 128 : raw;
    const coef = (signed * decoded.limits.sh1Max) / 63;
    expect(Math.abs(coef - 0.03)).toBeLessThan(0.01);
  });

  it('reads the body as sequential non-overlapping ranges', async () => {
    const blob = gaussianBlob(5, 5);
    const headerBytes = Buffer.from(gaussianHeader(5)).byteLength;
    const end = headerBytes + 5 * 248;
    const calls: Array<[number, number]> = [];
    const source: ByteSource = {
      size: blob.size,
      async read(start: number, endByte: number) {
        calls.push([start, endByte]);
        return blob.slice(start, endByte).arrayBuffer();
      },
    };
    await decodeGaussianPly(source, { budget: desktop, preferExtended: false, chunkBytes: 500 });
    const body = calls.filter(([start]) => start >= headerBytes);
    expect(body.length).toBeGreaterThan(0);
    let cursor = headerBytes;
    for (const [start, stop] of body) {
      expect(start).toBe(cursor);
      expect(stop).toBeGreaterThan(start);
      expect(stop).toBeLessThanOrEqual(end);
      cursor = stop;
    }
    expect(cursor).toBe(end);
  });
});

function gaussianBlobAt(xs: number[], rest0 = 0): Blob {
  const header = Buffer.from(gaussianHeader(xs.length));
  const body = Buffer.alloc(xs.length * 248);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  for (let i = 0; i < xs.length; i += 1) writeSplat(view, i * 248, xs[i] ?? 0, rest0);
  return new Blob([header, body]);
}

describe('planGaussianDecode', () => {
  it('keeps a 14,161,020 splat cloud on an 8 GB desktop by lowering SH before subsampling', () => {
    const budget = detectMemoryBudget({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      deviceMemory: 8,
      hardwareConcurrency: 8,
      maxTouchPoints: 0,
    });
    const plan = planGaussianDecode({
      sourceCount: 14_161_020,
      sourceSh: 3,
      budget,
      preferExtended: true,
    });
    expect(plan.decodedCount).toBe(14_161_020);
    expect(plan.stride).toBe(1);
    expect(plan.extended).toBe(true);
    expect(plan.shDegree).toBe(2);
    expect(plan.lod).toBe(false);
    expect(plan.notes.join(' ')).not.toMatch(/level of detail/i);
    expect(plan.estimatedBytes).toBeLessThanOrEqual(Math.floor(budget.cpuBytes * 0.62));
    expect(estimateDecodedBytes(plan.decodedCount, plan.shDegree, true)).toBe(plan.estimatedBytes);
  });

  it('subsamples on a phone instead of allocating the full cloud', () => {
    const budget = detectMemoryBudget({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      deviceMemory: 4,
      hardwareConcurrency: 4,
    });
    const plan = planGaussianDecode({
      sourceCount: 14_161_020,
      sourceSh: 3,
      budget,
      preferExtended: true,
    });
    expect(plan.decodedCount).toBeLessThanOrEqual(700_000);
    expect(plan.decodedCount).toBeLessThanOrEqual(budget.maxSplatsResident);
    expect(plan.stride).toBeGreaterThan(1);
    expect(plan.extended).toBe(true);
    expect(plan.shDegree).toBeGreaterThanOrEqual(1);
    expect(plan.shDegree).toBeLessThanOrEqual(budget.maxSh);
    expect(plan.notes.join(' ')).toMatch(/1 of every/);
    expect(plan.lod).toBe(false);
  });

  it('drops float32 centers and then subsamples when the budget is tiny', () => {
    const plan = planGaussianDecode({
      sourceCount: 8_000,
      sourceSh: 3,
      budget: {
        profile: 'desktop',
        cpuBytes: 64 * 1024,
        maxPoints: 100,
        maxSplatsResident: 100,
        maxSh: 3,
        pixelRatioCap: 1,
      },
      preferExtended: true,
    });
    expect(plan.extended).toBe(false);
    expect(plan.shDegree).toBe(0);
    expect(plan.decodedCount).toBeLessThan(8_000);
    expect(plan.notes.join(' ')).toMatch(/half-float/);
  });

  it('leaves LoD off when a second copy would fit, unless lod=force', () => {
    const budget = detectMemoryBudget({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      deviceMemory: 8,
      hardwareConcurrency: 8,
      maxTouchPoints: 0,
    });
    const sourceCount = 7_900_000;
    const base = {
      sourceCount,
      sourceSh: 3 as const,
      budget,
      preferExtended: true,
    };
    const plan = planGaussianDecode(base);
    expect(plan.decodedCount).toBe(sourceCount);
    expect(plan.stride).toBe(1);
    expect(plan.shDegree).toBeGreaterThanOrEqual(2);
    expect(plan.estimatedBytes * 2).toBeLessThanOrEqual(budget.cpuBytes * 0.85);
    expect(plan.lod).toBe(false);
    expect(plan.notes.join(' ')).not.toMatch(/level of detail/i);

    const forced = planGaussianDecode({ ...base, overrides: { forceLod: true } });
    expect(forced.lod).toBe(true);
    expect(forced.decodedCount).toBe(plan.decodedCount);
    expect(forced.shDegree).toBe(plan.shDegree);
    expect(forced.extended).toBe(plan.extended);

    const below = planGaussianDecode({
      sourceCount: LOD_ABOVE - 1,
      sourceSh: 0,
      budget,
      preferExtended: false,
      overrides: { forceLod: true },
    });
    expect(below.lod).toBe(false);
  });

  it('forces LoD and caps spherical harmonics from URL overrides', () => {
    const budget = detectMemoryBudget({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      deviceMemory: 8,
      hardwareConcurrency: 8,
      maxTouchPoints: 0,
    });
    const forced = planGaussianDecode({
      sourceCount: 14_161_020,
      sourceSh: 3,
      budget,
      preferExtended: true,
      overrides: { forceLod: true },
    });
    expect(forced.lod).toBe(true);
    expect(forced.decodedCount).toBe(14_161_020);
    const capped = planGaussianDecode({
      sourceCount: 14_161_020,
      sourceSh: 3,
      budget,
      preferExtended: true,
      overrides: { maxSh: 1 },
    });
    expect(capped.shDegree).toBeLessThanOrEqual(1);
  });
});

describe('explainLoadError', () => {
  it('replaces a bare WASM unreachable trap', () => {
    const error = new WebAssembly.RuntimeError('unreachable');
    const text = explainLoadError(error);
    expect(text).not.toBe('unreachable');
    expect(text.toLowerCase()).toMatch(/webassembly/);
    expect(text).toMatch(/paged \.rad/);
  });
});

describe('writePackedSplat', () => {
  it('stores color in the first word and half-float xyz', () => {
    const packed = new Uint32Array(4);
    writePackedSplat(packed, 0, 1.5, -2, 4, 1, 1, 1, 0, 0, 0, 1, 1, 0.25, 0.5, 0.75, DEFAULT_LIMITS);
    expect(packed[0]! & 255).toBe(Math.round(0.25 * 255));
    expect((packed[0]! >>> 8) & 255).toBe(Math.round(0.5 * 255));
    expect((packed[0]! >>> 16) & 255).toBe(Math.round(0.75 * 255));
    expect(packed[0]! >>> 24).toBe(255);
    expect(packed[1]! & 65535).toBe(toHalf(1.5));
    expect(packed[1]! >>> 16).toBe(toHalf(-2));
    expect(packed[2]! & 65535).toBe(toHalf(4));
  });
});
