import { describe, expect, it } from 'vitest';
import {
  GROUND_DETECTION_LIMITS,
  createGroundProposalJob,
  type GroundCandidate,
  type GroundProposalInput,
  type GroundProposalJob,
  type GroundProposalResult,
  type SampleProvenance,
} from '../src/game/groundDetection';

const UP: readonly [number, number, number] = [0, 0, 1];
const PROVENANCE: SampleProvenance = 'points';

function pack(points: Array<readonly [number, number, number]>): Float32Array {
  const positions = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i];
    if (!point) continue;
    positions[i * 3] = point[0];
    positions[i * 3 + 1] = point[1];
    positions[i * 3 + 2] = point[2];
  }
  return positions;
}

function grid(
  nx: number,
  ny: number,
  at: (i: number, j: number) => readonly [number, number, number],
): Float32Array {
  const points: Array<readonly [number, number, number]> = [];
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      points.push(at(i, j));
    }
  }
  return pack(points);
}

function baseInput(
  positions: Float32Array,
  overrides: Partial<GroundProposalInput> = {},
): GroundProposalInput {
  return {
    samples: { positions, provenance: overrides.samples?.provenance ?? PROVENANCE },
    upHint: overrides.upHint ?? UP,
    distanceTolerance: overrides.distanceTolerance ?? 0.15,
    maxSamples: overrides.maxSamples ?? Math.max(positions.length / 3, 16),
    maxHypotheses: overrides.maxHypotheses ?? 48,
    maxCandidates: overrides.maxCandidates ?? 3,
    minSupport: overrides.minSupport ?? 20,
    seed: overrides.seed ?? 7,
    ...(overrides.maxWork !== undefined ? { maxWork: overrides.maxWork } : {}),
  };
}

function run(job: GroundProposalJob, chunk: number): GroundProposalResult {
  let last = job.step(chunk);
  let guards = 0;
  while (last.status !== 'done') {
    guards += 1;
    if (guards > 2_000_000) throw new Error('job did not finish');
    last = job.step(chunk);
  }
  return last.result;
}

function createAndRun(input: GroundProposalInput, chunk = 10_000): GroundProposalResult {
  const created = createGroundProposalJob(input);
  if (created.kind !== 'job') {
    throw new Error(`expected job, got ${created.kind}:${created.reason}`);
  }
  return run(created.job, chunk);
}

function expectCandidates(result: GroundProposalResult): readonly [GroundCandidate, ...GroundCandidate[]] {
  expect(result.kind).toBe('candidates');
  if (result.kind !== 'candidates') throw new Error('expected candidates');
  return result.candidates;
}

function angleDeg(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return (Math.acos(Math.abs(dot)) * 180) / Math.PI;
}

function planeHeight(candidate: GroundCandidate, x: number, y: number): number {
  const [nx, ny, nz] = candidate.normal;
  if (Math.abs(nz) < 1e-8) throw new Error('vertical plane');
  return -(candidate.offset + nx * x + ny * y) / nz;
}

describe('createGroundProposalJob validation', () => {
  const ok = pack([
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
  ]);

  it('rejects invalid positions, zero/nonfinite up hints, and non-positive tolerances', () => {
    expect(createGroundProposalJob(baseInput(new Float32Array([1, 2]), { maxSamples: 8, minSupport: 3 })).kind).toBe(
      'invalid-input',
    );
    const short = createGroundProposalJob(baseInput(new Float32Array([1, 2]), { maxSamples: 8, minSupport: 3 }));
    if (short.kind === 'invalid-input') expect(short.reason).toBe('invalid-positions');

    const zeroHint = createGroundProposalJob(baseInput(ok, { upHint: [0, 0, 0], minSupport: 3 }));
    expect(zeroHint.kind).toBe('invalid-input');
    if (zeroHint.kind === 'invalid-input') expect(zeroHint.reason).toBe('invalid-up-hint');

    const nanHint = createGroundProposalJob(baseInput(ok, { upHint: [Number.NaN, 0, 1], minSupport: 3 }));
    expect(nanHint.kind).toBe('invalid-input');
    if (nanHint.kind === 'invalid-input') expect(nanHint.reason).toBe('invalid-up-hint');

    for (const distanceTolerance of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = createGroundProposalJob(baseInput(ok, { distanceTolerance, minSupport: 3 }));
      expect(result.kind).toBe('invalid-input');
      if (result.kind === 'invalid-input') expect(result.reason).toBe('invalid-distance-tolerance');
    }
  });

  it('rejects non-integer or out-of-range caps, seeds, and minSupport, without clamping', () => {
    expect(
      createGroundProposalJob(baseInput(ok, { maxSamples: GROUND_DETECTION_LIMITS.maxSamples + 1, minSupport: 3 })).kind,
    ).toBe('invalid-input');
    expect(createGroundProposalJob(baseInput(ok, { maxHypotheses: 0, minSupport: 3 })).kind).toBe('invalid-input');
    expect(createGroundProposalJob(baseInput(ok, { maxHypotheses: 1.5, minSupport: 3 })).kind).toBe('invalid-input');
    expect(createGroundProposalJob(baseInput(ok, { maxCandidates: 9, minSupport: 3 })).kind).toBe('invalid-input');
    expect(createGroundProposalJob(baseInput(ok, { minSupport: 2 })).kind).toBe('invalid-input');
    expect(createGroundProposalJob(baseInput(ok, { seed: -1, minSupport: 3 })).kind).toBe('invalid-input');
    expect(createGroundProposalJob(baseInput(ok, { seed: 1.2, minSupport: 3 })).kind).toBe('invalid-input');
    expect(createGroundProposalJob(baseInput(ok, { maxWork: 0, minSupport: 3 })).kind).toBe('invalid-input');
    expect(
      createGroundProposalJob(
        baseInput(ok, { maxWork: GROUND_DETECTION_LIMITS.maxWork + 1, minSupport: 3 }),
      ).kind,
    ).toBe('invalid-input');
  });

  it('rejects a buffer longer than maxSamples in O(1) as a cap, not as no-floor', () => {
    const positions = grid(6, 6, (i, j) => [i, j, 0]);
    const result = createGroundProposalJob(baseInput(positions, { maxSamples: 10, minSupport: 3 }));
    expect(result.kind).toBe('invalid-input');
    if (result.kind === 'invalid-input') expect(result.reason).toBe('sample-count-exceeds-max');
  });

  it('normalizes a nonzero up hint and does not mutate the caller tuple', () => {
    const hint: [number, number, number] = [0, 0, 2];
    const created = createGroundProposalJob(baseInput(grid(12, 12, (i, j) => [i, j, 0]), { upHint: hint, minSupport: 20 }));
    expect(created.kind).toBe('job');
    expect(hint).toEqual([0, 0, 2]);
  });
});

describe('ground proposal behavior', () => {
  it('recovers a broad floor and does not label it walkable or metric', () => {
    const positions = grid(16, 16, (i, j) => [i * 0.5, j * 0.5, 0.02]);
    const result = createAndRun(baseInput(positions));
    const [first] = expectCandidates(result);
    expect(angleDeg(first.normal, [0, 0, 1])).toBeLessThan(2);
    expect(first.inlierCount).toBeGreaterThanOrEqual(20);
    expect(first.spread).toBeGreaterThan(1);
    expect(first.rms).toBeLessThan(0.05);
    expect(result.kind).toBe('candidates');
    if (result.kind === 'candidates') {
      expect(result).not.toHaveProperty('walkable');
      expect(JSON.stringify(result)).not.toMatch(/meter|walkable|confidence/i);
      expect(result.ambiguous).toBe(false);
      expect(result.evidence.finiteCount).toBe(256);
      expect(result.evidence.caps.maxCandidates).toBe(3);
    }
  });

  it('keeps two parallel levels distinct, marks ambiguity, and does not return a midpoint', () => {
    const points: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < 14; i += 1) {
      for (let j = 0; j < 14; j += 1) {
        points.push([i * 0.4, j * 0.4, 0]);
        points.push([i * 0.4, j * 0.4, 3]);
      }
    }
    const result = createAndRun(baseInput(pack(points), { distanceTolerance: 0.12, minSupport: 40, seed: 11 }));
    expect(result.kind).toBe('candidates');
    if (result.kind !== 'candidates') return;
    expect(result.ambiguous).toBe(true);
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    const heights = result.candidates.map((candidate) => planeHeight(candidate, 2.4, 2.4)).sort((a, b) => a - b);
    const low = heights[0] ?? 0;
    const high = heights[heights.length - 1] ?? 0;
    expect(low).toBeCloseTo(0, 1);
    expect(high).toBeCloseTo(3, 1);
    expect(heights.every((height) => Math.abs(height - 1.5) > 0.6)).toBe(true);
  });

  it('still proposes a broad floor when a dense table cluster has more points', () => {
    const points: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < 18; i += 1) {
      for (let j = 0; j < 18; j += 1) {
        points.push([i, j, 0]);
      }
    }
    for (let i = 0; i < 30; i += 1) {
      for (let j = 0; j < 30; j += 1) {
        points.push([8 + i * 0.03, 8 + j * 0.03, 1]);
      }
    }
    const result = createAndRun(
      baseInput(pack(points), { distanceTolerance: 0.12, minSupport: 50, maxHypotheses: 80, seed: 3 }),
    );
    expect(result.kind).toBe('candidates');
    if (result.kind !== 'candidates') return;
    const floors = result.candidates.filter((candidate) => Math.abs(planeHeight(candidate, 8, 8)) < 0.3);
    expect(floors.length).toBeGreaterThanOrEqual(1);
    const floor = floors[0];
    if (!floor) return;
    const tables = result.candidates.filter((candidate) => Math.abs(planeHeight(candidate, 8.4, 8.4) - 1) < 0.3);
    if (tables[0]) expect(floor.spread).toBeGreaterThan(tables[0].spread);
    expect(floor.spread).toBeGreaterThan(40);
  });

  it('recovers a tilted plane under outliers', () => {
    const tilt = (12 * Math.PI) / 180;
    const points: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < 16; i += 1) {
      for (let j = 0; j < 16; j += 1) {
        const x = (i - 7.5) * 0.4;
        const y = (j - 7.5) * 0.4;
        points.push([x, y, x * Math.tan(tilt)]);
      }
    }
    for (let k = 0; k < 40; k += 1) {
      points.push([((k * 13) % 11) - 5, ((k * 7) % 11) - 5, 4 + (k % 5)]);
    }
    const result = createAndRun(baseInput(pack(points), { distanceTolerance: 0.12, minSupport: 40, seed: 19 }));
    const [first] = expectCandidates(result);
    const expected: [number, number, number] = [-Math.sin(tilt), 0, Math.cos(tilt)];
    expect(angleDeg(first.normal, expected)).toBeLessThan(3);
    expect(first.inlierCount).toBeGreaterThan(150);
  });

  it('does not propose a wall as the floor and stays unavailable when only a wall is present', () => {
    const mixed: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < 14; i += 1) {
      for (let j = 0; j < 14; j += 1) {
        mixed.push([i * 0.4, j * 0.4, 0]);
      }
    }
    for (let i = 0; i < 14; i += 1) {
      for (let k = 0; k < 12; k += 1) {
        mixed.push([0, i * 0.4, k * 0.3]);
      }
    }
    const withFloor = createAndRun(baseInput(pack(mixed), { minSupport: 30, seed: 5 }));
    const [first] = expectCandidates(withFloor);
    expect(angleDeg(first.normal, [0, 0, 1])).toBeLessThan(4);
    expect(Math.abs(first.normal[0])).toBeLessThan(0.2);

    const wallOnly = grid(16, 16, (i, k) => [0, i * 0.3, k * 0.3]);
    const result = createAndRun(baseInput(wallOnly, { minSupport: 20, seed: 2 }));
    expect(result.kind).toBe('unavailable');
    if (result.kind === 'unavailable') expect(result.reason).toBe('no-aligned-plane');
  });

  it('returns explicit reasons for empty, collinear, and random insufficient support', () => {
    const empty = createAndRun(baseInput(new Float32Array(), { maxSamples: 16, minSupport: 3 }));
    expect(empty.kind).toBe('unavailable');
    if (empty.kind === 'unavailable') expect(empty.reason).toBe('empty');

    const line = pack(Array.from({ length: 40 }, (_, i) => [i, 2 * i, -i] as const));
    const degenerate = createAndRun(baseInput(line, { minSupport: 3, maxSamples: 40 }));
    expect(degenerate.kind).toBe('unavailable');
    if (degenerate.kind === 'unavailable') expect(['degenerate', 'insufficient-support', 'no-aligned-plane']).toContain(
      degenerate.reason,
    );

    const random = pack(
      Array.from({ length: 60 }, (_, i) => {
        const x = Math.sin(i * 12.9898 + 0.1) * 8;
        const y = Math.sin(i * 78.233 + 1.7) * 8;
        const z = Math.sin(i * 37.719 + 2.3) * 8;
        return [x, y, z] as const;
      }),
    );
    const insufficient = createAndRun(
      baseInput(random, { distanceTolerance: 0.05, minSupport: 20, maxSamples: 60, seed: 99 }),
    );
    expect(insufficient.kind).toBe('unavailable');
    if (insufficient.kind === 'unavailable') expect(insufficient.reason).toBe('insufficient-support');
  });

  it('scales equivalently when positions and tolerance are scaled together', () => {
    const source: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < 12; i += 1) {
      for (let j = 0; j < 12; j += 1) {
        source.push([i * 0.5, j * 0.5, 0.4 + ((i + j) % 3) * 0.001]);
      }
    }
    const unit = createAndRun(baseInput(pack(source), { distanceTolerance: 0.1, minSupport: 20, seed: 4 }));
    const [a] = expectCandidates(unit);
    const scaledPts = source.map(([x, y, z]) => [x * 1000, y * 1000, z * 1000] as const);
    const scaled = createAndRun(
      baseInput(pack(scaledPts), { distanceTolerance: 100, minSupport: 20, seed: 4 }),
    );
    const [b] = expectCandidates(scaled);
    expect(angleDeg(a.normal, b.normal)).toBeLessThan(1);
    expect(Math.abs(b.offset / a.offset / 1000 - 1)).toBeLessThan(1e-5);
    expect(Math.abs((b.centroid[2] ?? 0) / (a.centroid[2] ?? 1) / 1000 - 1)).toBeLessThan(1e-5);
    expect(Math.abs(b.rms / Math.max(a.rms, 1e-12) / 1000 - 1)).toBeLessThan(1e-5);
    expect(Math.abs(b.spread / a.spread / 1_000_000 - 1)).toBeLessThan(1e-5);
  });

  it('is deterministic for the same ordered input and seed across step sizes', () => {
    const points: Array<readonly [number, number, number]> = [];
    for (let i = 0; i < 15; i += 1) {
      for (let j = 0; j < 15; j += 1) {
        points.push([i * 0.35, j * 0.35, ((i + j) % 3) * 0.01]);
      }
    }
    const input = baseInput(pack(points), { seed: 123, minSupport: 25, maxHypotheses: 40 });
    const results = [1, 7, 64, 10_000].map((chunk) => {
      const created = createGroundProposalJob(input);
      expect(created.kind).toBe('job');
      if (created.kind !== 'job') throw new Error('expected job');
      return run(created.job, chunk);
    });
    const first = results[0];
    for (const other of results.slice(1)) expect(other).toEqual(first);
  });

  it('treats a tight work budget as capped evidence, not as no-floor', () => {
    const positions = grid(20, 20, (i, j) => [i, j, 0]);
    const capped = createAndRun(baseInput(positions, { maxWork: 8, minSupport: 20, maxSamples: 400 }));
    expect(capped.kind).toBe('capped');
    if (capped.kind === 'capped') {
      expect(capped.reason).toBe('work-cap');
      expect(capped.candidates).toEqual([]);
      expect(capped.evidence.workUnits).toBe(8);
      expect(capped.evidence.maxWork).toBe(8);
    }
    const complete = createAndRun(baseInput(positions, { minSupport: 20, maxSamples: 400 }));
    expect(complete.kind).toBe('candidates');
  });

  it('reports skipped nonfinite samples in evidence and still fits the finite floor', () => {
    const positions = new Float32Array(12 * 12 * 3 + 6);
    let o = 0;
    for (let i = 0; i < 12; i += 1) {
      for (let j = 0; j < 12; j += 1) {
        positions[o] = i;
        positions[o + 1] = j;
        positions[o + 2] = 0;
        o += 3;
      }
    }
    positions[o] = Number.NaN;
    positions[o + 1] = 0;
    positions[o + 2] = 0;
    positions[o + 3] = Number.POSITIVE_INFINITY;
    positions[o + 4] = 1;
    positions[o + 5] = 1;
    const result = createAndRun(baseInput(positions, { maxSamples: 200, minSupport: 20 }));
    const [first] = expectCandidates(result);
    expect(angleDeg(first.normal, [0, 0, 1])).toBeLessThan(2);
    if (result.kind === 'candidates') {
      expect(result.evidence.sampleCount).toBe(12 * 12 + 2);
      expect(result.evidence.finiteCount).toBe(12 * 12);
    }
  });

  it('leaves job.result undefined until the job is done, and step is idempotent after', () => {
    const created = createGroundProposalJob(baseInput(grid(10, 10, (i, j) => [i, j, 0]), { minSupport: 15 }));
    expect(created.kind).toBe('job');
    if (created.kind !== 'job') return;
    expect(created.job.result).toBeUndefined();
    const first = created.job.step(1);
    if (first.status === 'running') {
      expect(created.job.result).toBeUndefined();
      expect(first.progress).toBeGreaterThanOrEqual(0);
      expect(first.progress).toBeLessThan(1);
    }
    const done = run(created.job, 1_000);
    expect(created.job.result).toEqual(done);
    expect(created.job.step(50)).toEqual({ status: 'done', progress: 1, result: done });
  });

  it('ignores non-positive step budgets without changing a finished or unused job', () => {
    const created = createGroundProposalJob(baseInput(grid(8, 8, (i, j) => [i, j, 0]), { minSupport: 10 }));
    expect(created.kind).toBe('job');
    if (created.kind !== 'job') return;
    const paused = created.job.step(0);
    expect(paused.status).toBe('running');
    expect(paused.progress).toBe(0);
    expect(created.job.step(Number.NaN).progress).toBe(0);
    const result = run(created.job, 2_000);
    expect(result.kind).toBe('candidates');
  });
});
