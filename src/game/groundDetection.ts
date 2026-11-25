/**
 * Pure, incremental ground-plane proposal job.
 * Coordinates are caller-centered sample units. This module does not infer
 * meters, walkability, or a preferred scene transform.
 */
export const GROUND_DETECTION_LIMITS = {
  maxSamples: 24_000,
  maxHypotheses: 256,
  maxCandidates: 8,
  maxWork: 32_000_000,
} as const;

export type SampleProvenance = 'mesh-surface' | 'points' | 'gaussian-centers';

export interface GroundSamples {
  readonly positions: Float32Array;
  readonly provenance: SampleProvenance;
}

export interface GroundProposalInput {
  readonly samples: GroundSamples;
  readonly upHint: readonly [number, number, number];
  readonly distanceTolerance: number;
  readonly maxSamples: number;
  readonly maxHypotheses: number;
  readonly maxCandidates: number;
  readonly minSupport: number;
  readonly seed: number;
  /** Optional hard cap on billed work units. Omitted uses a sufficient default. */
  readonly maxWork?: number;
}

export type InvalidInputReason =
  | 'invalid-positions'
  | 'invalid-up-hint'
  | 'invalid-distance-tolerance'
  | 'invalid-max-samples'
  | 'invalid-max-hypotheses'
  | 'invalid-max-candidates'
  | 'invalid-min-support'
  | 'invalid-seed'
  | 'invalid-max-work'
  | 'sample-count-exceeds-max';

export type UnavailableReason = 'empty' | 'insufficient-support' | 'degenerate' | 'no-aligned-plane';

export interface GroundEvidence {
  readonly sampleCount: number;
  readonly finiteCount: number;
  readonly usedCount: number;
  readonly hypothesisCount: number;
  readonly workUnits: number;
  readonly maxWork: number;
  readonly caps: {
    readonly maxSamples: number;
    readonly maxHypotheses: number;
    readonly maxCandidates: number;
  };
}

export interface GroundCandidate {
  readonly normal: readonly [number, number, number];
  readonly offset: number;
  readonly centroid: readonly [number, number, number];
  readonly inlierCount: number;
  readonly sampleCount: number;
  readonly rms: number;
  readonly spread: number;
}

export interface CandidatesResult {
  readonly kind: 'candidates';
  readonly candidates: readonly [GroundCandidate, ...GroundCandidate[]];
  readonly ambiguous: boolean;
  readonly evidence: GroundEvidence;
}

export interface UnavailableResult {
  readonly kind: 'unavailable';
  readonly reason: UnavailableReason;
  readonly evidence: GroundEvidence;
}

export interface CappedResult {
  readonly kind: 'capped';
  readonly reason: 'work-cap';
  readonly candidates: readonly GroundCandidate[];
  readonly evidence: GroundEvidence;
}

export type GroundProposalResult = CandidatesResult | UnavailableResult | CappedResult;

export type CreateGroundProposalJobResult =
  | { readonly kind: 'invalid-input'; readonly reason: InvalidInputReason }
  | { readonly kind: 'job'; readonly job: GroundProposalJob };

export type GroundProposalProgress =
  | { readonly status: 'running'; readonly progress: number }
  | { readonly status: 'done'; readonly progress: 1; readonly result: GroundProposalResult };

export interface GroundProposalJob {
  step(maxWorkUnits: number): GroundProposalProgress;
  readonly result: GroundProposalResult | undefined;
}

const MIN_UP_ALIGNMENT = 0.35;
const MERGE_NORMAL_DOT = 0.9961947;
const GRID = 48;
const ZERO_LEN = 1e-12;
const AREA_EPS = 1e-20;

type Phase = 'validate' | 'generate' | 'score' | 'refit' | 'measure-bounds' | 'measure-grid' | 'finish';

interface Hypothesis {
  nx: number;
  ny: number;
  nz: number;
  d: number;
  ux: number;
  uy: number;
  uz: number;
  vx: number;
  vy: number;
  vz: number;
  inliers: number;
  sumX: number;
  sumY: number;
  sumZ: number;
  sumXX: number;
  sumXY: number;
  sumXZ: number;
  sumYY: number;
  sumYZ: number;
  sumZZ: number;
  sumRes2: number;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  cursor: number;
  occupied: number;
}

interface ParsedInput {
  positions: Float32Array;
  sampleCount: number;
  upX: number;
  upY: number;
  upZ: number;
  tolerance: number;
  maxSamples: number;
  maxHypotheses: number;
  maxCandidates: number;
  minSupport: number;
  seed: number;
  maxWork: number;
}

export function createGroundProposalJob(input: GroundProposalInput): CreateGroundProposalJobResult {
  const parsed = parseInput(input);
  if (parsed.kind === 'invalid-input') return parsed;
  return { kind: 'job', job: new GroundJob(parsed.value) };
}

function parseInput(
  input: GroundProposalInput,
): { kind: 'invalid-input'; reason: InvalidInputReason } | { kind: 'ok'; value: ParsedInput } {
  const positions = input.samples?.positions;
  if (!(positions instanceof Float32Array) || positions.length % 3 !== 0) {
    return { kind: 'invalid-input', reason: 'invalid-positions' };
  }
  const sampleCount = positions.length / 3;
  if (!isPositiveInt(input.maxSamples) || input.maxSamples > GROUND_DETECTION_LIMITS.maxSamples) {
    return { kind: 'invalid-input', reason: 'invalid-max-samples' };
  }
  if (sampleCount > input.maxSamples) {
    return { kind: 'invalid-input', reason: 'sample-count-exceeds-max' };
  }
  const hint = normalizeHint(input.upHint);
  if (!hint) return { kind: 'invalid-input', reason: 'invalid-up-hint' };
  if (!Number.isFinite(input.distanceTolerance) || input.distanceTolerance <= 0) {
    return { kind: 'invalid-input', reason: 'invalid-distance-tolerance' };
  }
  if (!isPositiveInt(input.maxHypotheses) || input.maxHypotheses > GROUND_DETECTION_LIMITS.maxHypotheses) {
    return { kind: 'invalid-input', reason: 'invalid-max-hypotheses' };
  }
  if (!isPositiveInt(input.maxCandidates) || input.maxCandidates > GROUND_DETECTION_LIMITS.maxCandidates) {
    return { kind: 'invalid-input', reason: 'invalid-max-candidates' };
  }
  if (!isPositiveInt(input.minSupport) || input.minSupport < 3 || input.minSupport > input.maxSamples) {
    return { kind: 'invalid-input', reason: 'invalid-min-support' };
  }
  if (!isUint32(input.seed)) return { kind: 'invalid-input', reason: 'invalid-seed' };
  let maxWork: number;
  if (input.maxWork === undefined) {
    maxWork = defaultMaxWork(sampleCount, input.maxHypotheses, input.maxCandidates);
  } else if (!isPositiveInt(input.maxWork) || input.maxWork > GROUND_DETECTION_LIMITS.maxWork) {
    return { kind: 'invalid-input', reason: 'invalid-max-work' };
  } else {
    maxWork = input.maxWork;
  }
  return {
    kind: 'ok',
    value: {
      positions,
      sampleCount,
      upX: hint[0],
      upY: hint[1],
      upZ: hint[2],
      tolerance: input.distanceTolerance,
      maxSamples: input.maxSamples,
      maxHypotheses: input.maxHypotheses,
      maxCandidates: input.maxCandidates,
      minSupport: input.minSupport,
      seed: input.seed >>> 0,
      maxWork,
    },
  };
}

function defaultMaxWork(sampleCount: number, maxHypotheses: number, _maxCandidates: number): number {
  // Validate + score + refit + two measure passes over every hypothesis in the worst case.
  const planned = sampleCount * (1 + 4 * maxHypotheses) + maxHypotheses * 4 + 8;
  return Math.min(GROUND_DETECTION_LIMITS.maxWork, Math.max(1, planned));
}

function isPositiveInt(value: number): boolean {
  return Number.isInteger(value) && value > 0 && Number.isSafeInteger(value);
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
}

function normalizeHint(hint: readonly [number, number, number] | undefined): [number, number, number] | null {
  if (!hint || hint.length !== 3) return null;
  const x = hint[0];
  const y = hint[1];
  const z = hint[2];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  const len = Math.hypot(x, y, z);
  if (!(len > ZERO_LEN)) return null;
  return [x / len, y / len, z / len];
}

class GroundJob implements GroundProposalJob {
  private phase: Phase = 'validate';
  private workUnits = 0;
  private cursor = 0;
  private finiteCount = 0;
  private finiteIndex: Uint32Array | null = null;
  private rngState: number;
  private attempts = 0;
  private readonly maxAttempts: number;
  private readonly hypotheses: Hypothesis[] = [];
  private selected: Hypothesis[] = [];
  private selectIndex = 0;
  private grid: Uint8Array | null = null;
  private finalResult: GroundProposalResult | undefined;
  private readonly planned: number;

  constructor(private readonly input: ParsedInput) {
    this.rngState = input.seed >>> 0;
    this.maxAttempts = input.maxHypotheses * 4;
    this.planned = defaultMaxWork(input.sampleCount, input.maxHypotheses, input.maxCandidates);
  }

  get result(): GroundProposalResult | undefined {
    return this.finalResult;
  }

  step(maxWorkUnits: number): GroundProposalProgress {
    if (this.finalResult) return { status: 'done', progress: 1, result: this.finalResult };
    let remaining = Number.isInteger(maxWorkUnits) && maxWorkUnits > 0 ? maxWorkUnits : 0;
    let stalls = 0;
    while (!this.finalResult && stalls < 10_000) {
      if (this.phase === 'finish') {
        this.finishComplete();
        break;
      }
      if (this.workUnits >= this.input.maxWork) {
        this.finishCapped();
        break;
      }
      if (remaining <= 0) break;
      const used = this.advanceOne();
      if (used > 0) {
        remaining -= used;
        stalls = 0;
      } else {
        stalls += 1;
      }
    }
    if (this.finalResult) return { status: 'done', progress: 1, result: this.finalResult };
    if (this.workUnits >= this.input.maxWork) {
      this.finishCapped();
      const capped = this.finalResult;
      if (capped) return { status: 'done', progress: 1, result: capped };
    }
    return { status: 'running', progress: this.runningProgress() };
  }

  private runningProgress(): number {
    const denom = Math.max(this.planned, this.input.maxWork, 1);
    const value = this.workUnits / denom;
    if (value <= 0) return 0;
    if (value >= 1) return 0.999;
    return value;
  }

  private bill(units: number): boolean {
    const next = this.workUnits + units;
    if (next > this.input.maxWork) {
      this.workUnits = this.input.maxWork;
      return false;
    }
    this.workUnits = next;
    return true;
  }

  private advanceOne(): number {
    switch (this.phase) {
      case 'validate':
        return this.stepValidate();
      case 'generate':
        return this.stepGenerate();
      case 'score':
        return this.stepScore();
      case 'refit':
        return this.stepRefit();
      case 'measure-bounds':
        return this.stepMeasureBounds();
      case 'measure-grid':
        return this.stepMeasureGrid();
      case 'finish':
        this.finishComplete();
        return 0;
      default: {
        const _exhaustive: never = this.phase;
        return _exhaustive;
      }
    }
  }

  private stepValidate(): number {
    if (!this.finiteIndex) this.finiteIndex = new Uint32Array(this.input.sampleCount);
    if (this.input.sampleCount === 0) {
      if (!this.bill(1)) return 1;
      this.finishUnavailable('empty');
      return 1;
    }
    if (this.cursor >= this.input.sampleCount) {
      this.phase = 'generate';
      this.cursor = 0;
      this.attempts = 0;
      if (this.finiteCount === 0) {
        this.finishUnavailable('empty');
      } else if (this.finiteCount < 3 || this.finiteCount < this.input.minSupport) {
        this.finishUnavailable(this.finiteCount < 3 ? 'degenerate' : 'insufficient-support');
      }
      return 0;
    }
    if (!this.bill(1)) return 1;
    const i = this.cursor;
    this.cursor += 1;
    const positions = this.input.positions;
    const x = positions[i * 3] ?? Number.NaN;
    const y = positions[i * 3 + 1] ?? Number.NaN;
    const z = positions[i * 3 + 2] ?? Number.NaN;
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
      const index = this.finiteIndex;
      if (index) {
        index[this.finiteCount] = i;
        this.finiteCount += 1;
      }
    }
    return 1;
  }

  private stepGenerate(): number {
    if (this.hypotheses.length >= this.input.maxHypotheses || this.attempts >= this.maxAttempts) {
      this.phase = 'score';
      this.cursor = 0;
      this.selectIndex = 0;
      if (this.hypotheses.length === 0) this.prepareScoreMiss();
      return 0;
    }
    if (!this.bill(1)) return 1;
    this.attempts += 1;
    const picked = this.pickThree();
    if (picked) this.tryHypothesis(picked[0], picked[1], picked[2]);
    return 1;
  }

  private prepareScoreMiss(): void {
    // Scoring a zero-hypothesis set is a no-op; finish after the score phase starts.
  }

  private stepScore(): number {
    if (this.hypotheses.length === 0) {
      this.phase = 'finish';
      return 0;
    }
    const h = this.hypotheses[this.selectIndex];
    if (!h) {
      this.beginRefit();
      return 0;
    }
    if (h.cursor >= this.finiteCount) {
      this.selectIndex += 1;
      if (this.selectIndex >= this.hypotheses.length) this.beginRefit();
      return 0;
    }
    if (!this.bill(1)) return 1;
    const sample = this.finiteAt(h.cursor);
    h.cursor += 1;
    if (sample && this.isInlier(h, sample[0], sample[1], sample[2])) {
      accumulateInlier(h, sample[0], sample[1], sample[2]);
    }
    return 1;
  }

  private beginRefit(): void {
    this.selected = this.hypotheses.filter((item) => item.inliers >= this.input.minSupport);
    if (this.selected.length === 0) {
      this.phase = 'finish';
      return;
    }
    for (const item of this.selected) {
      item.cursor = 0;
      item.sumX = 0;
      item.sumY = 0;
      item.sumZ = 0;
      item.sumXX = 0;
      item.sumXY = 0;
      item.sumXZ = 0;
      item.sumYY = 0;
      item.sumYZ = 0;
      item.sumZZ = 0;
      item.inliers = 0;
    }
    this.selectIndex = 0;
    this.phase = 'refit';
  }

  private stepRefit(): number {
    const h = this.selected[this.selectIndex];
    if (!h) {
      this.beginMeasure();
      return 0;
    }
    if (h.cursor >= this.finiteCount) {
      if (!refitFromCovariance(h, this.input)) {
        this.selected.splice(this.selectIndex, 1);
        return 0;
      }
      this.selectIndex += 1;
      if (this.selectIndex >= this.selected.length) this.beginMeasure();
      return 0;
    }
    if (!this.bill(1)) return 1;
    const sample = this.finiteAt(h.cursor);
    h.cursor += 1;
    if (sample && this.isInlier(h, sample[0], sample[1], sample[2])) {
      accumulateInlier(h, sample[0], sample[1], sample[2]);
    }
    return 1;
  }

  private beginMeasure(): void {
    if (this.selected.length === 0) {
      this.phase = 'finish';
      return;
    }
    for (const item of this.selected) resetMeasure(item);
    this.selectIndex = 0;
    this.phase = 'measure-bounds';
  }

  private stepMeasureBounds(): number {
    const h = this.selected[this.selectIndex];
    if (!h) {
      this.selectIndex = 0;
      this.phase = 'measure-grid';
      return 0;
    }
    if (h.cursor >= this.finiteCount) {
      this.selectIndex += 1;
      if (this.selectIndex >= this.selected.length) this.beginMeasureGrid();
      return 0;
    }
    if (!this.bill(1)) return 1;
    const sample = this.finiteAt(h.cursor);
    h.cursor += 1;
    if (sample && this.isInlier(h, sample[0], sample[1], sample[2])) {
      accumulateMeasure(h, sample[0], sample[1], sample[2]);
    }
    return 1;
  }

  private stepMeasureGrid(): number {
    const h = this.selected[this.selectIndex];
    if (!h) {
      this.phase = 'finish';
      return 0;
    }
    if (h.cursor >= this.finiteCount) {
      this.selectIndex += 1;
      if (this.selectIndex >= this.selected.length) this.phase = 'finish';
      return 0;
    }
    if (h.cursor === 0) this.resetGrid();
    if (!this.bill(1)) return 1;
    const sample = this.finiteAt(h.cursor);
    h.cursor += 1;
    if (sample && this.isInlier(h, sample[0], sample[1], sample[2])) {
      this.occupy(h, sample[0], sample[1], sample[2]);
    }
    return 1;
  }

  private isInlier(h: Hypothesis, x: number, y: number, z: number): boolean {
    const residual = h.nx * x + h.ny * y + h.nz * z + h.d;
    return residual <= this.input.tolerance && residual >= -this.input.tolerance;
  }

  private finiteAt(order: number): [number, number, number] | null {
    const index = this.finiteIndex;
    if (!index || order < 0 || order >= this.finiteCount) return null;
    const i = index[order] ?? 0;
    const positions = this.input.positions;
    return [positions[i * 3] ?? 0, positions[i * 3 + 1] ?? 0, positions[i * 3 + 2] ?? 0];
  }

  private pickThree(): [number, number, number] | null {
    const n = this.finiteCount;
    if (n < 3) return null;
    const i0 = this.randIndex(n);
    let i1 = this.randIndex(n - 1);
    if (i1 >= i0) i1 += 1;
    let i2 = this.randIndex(n - 2);
    const a = i0 < i1 ? i0 : i1;
    const b = i0 < i1 ? i1 : i0;
    if (i2 >= a) i2 += 1;
    if (i2 >= b) i2 += 1;
    return [i0, i1, i2];
  }

  private randIndex(n: number): number {
    if (n <= 0) return 0;
    return Math.floor(this.nextRng() * n);
  }

  private nextRng(): number {
    this.rngState = (this.rngState + 0x6d2b79f5) >>> 0;
    let t = this.rngState;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private tryHypothesis(a: number, b: number, c: number): void {
    const pa = this.finiteAt(a);
    const pb = this.finiteAt(b);
    const pc = this.finiteAt(c);
    if (!pa || !pb || !pc) return;
    const abx = pb[0] - pa[0];
    const aby = pb[1] - pa[1];
    const abz = pb[2] - pa[2];
    const acx = pc[0] - pa[0];
    const acy = pc[1] - pa[1];
    const acz = pc[2] - pa[2];
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (!(len > ZERO_LEN)) return;
    nx /= len;
    ny /= len;
    nz /= len;
    const align = nx * this.input.upX + ny * this.input.upY + nz * this.input.upZ;
    if (align < 0) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const oriented = nx * this.input.upX + ny * this.input.upY + nz * this.input.upZ;
    if (oriented < MIN_UP_ALIGNMENT) return;
    const axes = tangentAxes(nx, ny, nz);
    this.hypotheses.push(newHypothesis(nx, ny, nz, -(nx * pa[0] + ny * pa[1] + nz * pa[2]), axes));
  }

  private beginMeasureGrid(): void {
    for (const item of this.selected) {
      item.cursor = 0;
      item.occupied = 0;
    }
    this.selectIndex = 0;
    this.phase = 'measure-grid';
  }

  private resetGrid(): void {
    if (!this.grid) this.grid = new Uint8Array(GRID * GRID);
    else this.grid.fill(0);
    const h = this.selected[this.selectIndex];
    if (h) h.occupied = 0;
  }

  private occupy(h: Hypothesis, x: number, y: number, z: number): void {
    const grid = this.grid;
    if (!grid) return;
    const uSpan = Math.max(h.uMax - h.uMin, this.input.tolerance);
    const vSpan = Math.max(h.vMax - h.vMin, this.input.tolerance);
    const cell = Math.max(this.input.tolerance * 4, Math.max(uSpan, vSpan) / GRID);
    if (!(cell > 0)) return;
    const u = x * h.ux + y * h.uy + z * h.uz;
    const v = x * h.vx + y * h.vy + z * h.vz;
    const iu = clampIndex(Math.floor((u - h.uMin) / cell), GRID);
    const iv = clampIndex(Math.floor((v - h.vMin) / cell), GRID);
    const key = iu + GRID * iv;
    if (grid[key] === 0) {
      grid[key] = 1;
      h.occupied += 1;
    }
  }

  private evidence(): GroundEvidence {
    return {
      sampleCount: this.input.sampleCount,
      finiteCount: this.finiteCount,
      usedCount: this.finiteCount,
      hypothesisCount: this.hypotheses.length,
      workUnits: this.workUnits,
      maxWork: this.input.maxWork,
      caps: {
        maxSamples: this.input.maxSamples,
        maxHypotheses: this.input.maxHypotheses,
        maxCandidates: this.input.maxCandidates,
      },
    };
  }

  private finishCapped(): void {
    if (this.finalResult) return;
    this.finalResult = {
      kind: 'capped',
      reason: 'work-cap',
      candidates: [],
      evidence: this.evidence(),
    };
  }

  private finishUnavailable(reason: UnavailableReason): void {
    this.finalResult = { kind: 'unavailable', reason, evidence: this.evidence() };
  }

  private finishComplete(): void {
    if (this.selected.length === 0) {
      const reason: UnavailableReason =
        this.hypotheses.length === 0 && this.finiteCount >= 3 ? 'no-aligned-plane' : 'insufficient-support';
      this.finishUnavailable(this.finiteCount === 0 ? 'empty' : this.finiteCount < 3 ? 'degenerate' : reason);
      return;
    }
    const collected = this.collectCandidates();
    const first = collected.list[0];
    if (!first) {
      this.finishUnavailable('insufficient-support');
      return;
    }
    this.finalResult = {
      kind: 'candidates',
      candidates: [first, ...collected.list.slice(1)],
      ambiguous: collected.ambiguous,
      evidence: this.evidence(),
    };
  }

  private collectCandidates(): { list: GroundCandidate[]; ambiguous: boolean } {
    const usable = this.selected.filter((item) => item.inliers >= this.input.minSupport && isMeasured(item));
    usable.sort(compareHypotheses);
    const accepted: Hypothesis[] = [];
    for (const item of usable) {
      if (accepted.some((other) => samePlane(item, other, this.input.tolerance))) continue;
      accepted.push(item);
      if (accepted.length >= this.input.maxCandidates) break;
    }
    const list = accepted.map((item) => toCandidate(item, this.finiteCount, this.input.tolerance));
    return { list, ambiguous: list.length >= 2 };
  }
}

function newHypothesis(
  nx: number,
  ny: number,
  nz: number,
  d: number,
  axes: readonly [number, number, number, number, number, number],
): Hypothesis {
  return {
    nx,
    ny,
    nz,
    d,
    ux: axes[0],
    uy: axes[1],
    uz: axes[2],
    vx: axes[3],
    vy: axes[4],
    vz: axes[5],
    inliers: 0,
    sumX: 0,
    sumY: 0,
    sumZ: 0,
    sumXX: 0,
    sumXY: 0,
    sumXZ: 0,
    sumYY: 0,
    sumYZ: 0,
    sumZZ: 0,
    sumRes2: 0,
    uMin: Infinity,
    uMax: -Infinity,
    vMin: Infinity,
    vMax: -Infinity,
    cursor: 0,
    occupied: 0,
  };
}

function accumulateInlier(h: Hypothesis, x: number, y: number, z: number): void {
  h.inliers += 1;
  h.sumX += x;
  h.sumY += y;
  h.sumZ += z;
  h.sumXX += x * x;
  h.sumXY += x * y;
  h.sumXZ += x * z;
  h.sumYY += y * y;
  h.sumYZ += y * z;
  h.sumZZ += z * z;
}

function resetMeasure(h: Hypothesis): void {
  h.cursor = 0;
  h.inliers = 0;
  h.sumX = 0;
  h.sumY = 0;
  h.sumZ = 0;
  h.sumRes2 = 0;
  h.uMin = Infinity;
  h.uMax = -Infinity;
  h.vMin = Infinity;
  h.vMax = -Infinity;
  h.occupied = 0;
}

function accumulateMeasure(h: Hypothesis, x: number, y: number, z: number): void {
  h.inliers += 1;
  h.sumX += x;
  h.sumY += y;
  h.sumZ += z;
  const residual = h.nx * x + h.ny * y + h.nz * z + h.d;
  h.sumRes2 += residual * residual;
  const u = x * h.ux + y * h.uy + z * h.uz;
  const v = x * h.vx + y * h.vy + z * h.vz;
  if (u < h.uMin) h.uMin = u;
  if (u > h.uMax) h.uMax = u;
  if (v < h.vMin) h.vMin = v;
  if (v > h.vMax) h.vMax = v;
}

function refitFromCovariance(h: Hypothesis, input: ParsedInput): boolean {
  if (h.inliers < 3) return false;
  const inv = 1 / h.inliers;
  const cx = h.sumX * inv;
  const cy = h.sumY * inv;
  const cz = h.sumZ * inv;
  const xx = h.sumXX * inv - cx * cx;
  const xy = h.sumXY * inv - cx * cy;
  const xz = h.sumXZ * inv - cx * cz;
  const yy = h.sumYY * inv - cy * cy;
  const yz = h.sumYZ * inv - cy * cz;
  const zz = h.sumZZ * inv - cz * cz;
  const normal = smallestEigenvector(xx, xy, xz, yy, yz, zz);
  if (!normal) return false;
  let nx = normal[0];
  let ny = normal[1];
  let nz = normal[2];
  if (nx * input.upX + ny * input.upY + nz * input.upZ < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  const aligned = nx * input.upX + ny * input.upY + nz * input.upZ;
  if (aligned < MIN_UP_ALIGNMENT) return false;
  const axes = tangentAxes(nx, ny, nz);
  h.nx = nx;
  h.ny = ny;
  h.nz = nz;
  h.d = -(nx * cx + ny * cy + nz * cz);
  h.ux = axes[0];
  h.uy = axes[1];
  h.uz = axes[2];
  h.vx = axes[3];
  h.vy = axes[4];
  h.vz = axes[5];
  return true;
}

function toCandidate(h: Hypothesis, usedCount: number, tolerance: number): GroundCandidate {
  const inv = h.inliers > 0 ? 1 / h.inliers : 0;
  const uSpan = Math.max(h.uMax - h.uMin, 0);
  const vSpan = Math.max(h.vMax - h.vMin, 0);
  const cell = Math.max(tolerance * 4, Math.max(uSpan, vSpan) / GRID, 0);
  const spread = h.occupied > 0 ? h.occupied * cell * cell : uSpan * vSpan;
  return {
    normal: [h.nx, h.ny, h.nz],
    offset: h.d,
    centroid: [h.sumX * inv, h.sumY * inv, h.sumZ * inv],
    inlierCount: h.inliers,
    sampleCount: usedCount,
    rms: h.inliers > 0 ? Math.sqrt(h.sumRes2 / h.inliers) : 0,
    spread,
  };
}

function isMeasured(h: Hypothesis): boolean {
  return h.inliers > 0 && Number.isFinite(h.uMin) && Number.isFinite(h.uMax);
}

function compareHypotheses(a: Hypothesis, b: Hypothesis): number {
  const aArea = spreadProxy(a);
  const bArea = spreadProxy(b);
  if (bArea !== aArea) return bArea - aArea;
  if (b.inliers !== a.inliers) return b.inliers - a.inliers;
  const aRms = a.inliers > 0 ? a.sumRes2 / a.inliers : Infinity;
  const bRms = b.inliers > 0 ? b.sumRes2 / b.inliers : Infinity;
  if (aRms !== bRms) return aRms - bRms;
  return 0;
}

function spreadProxy(h: Hypothesis): number {
  if (h.occupied > 0) {
    const uSpan = Math.max(h.uMax - h.uMin, 0);
    const vSpan = Math.max(h.vMax - h.vMin, 0);
    const cell = Math.max((h.uMax - h.uMin > 0 || h.vMax - h.vMin > 0 ? Math.max(uSpan, vSpan) / GRID : 0), AREA_EPS);
    return h.occupied * cell * cell;
  }
  const uSpan = Math.max(h.uMax - h.uMin, 0);
  const vSpan = Math.max(h.vMax - h.vMin, 0);
  return uSpan * vSpan;
}

function samePlane(a: Hypothesis, b: Hypothesis, tolerance: number): boolean {
  const dot = a.nx * b.nx + a.ny * b.ny + a.nz * b.nz;
  if (dot < MERGE_NORMAL_DOT) return false;
  const cx = b.inliers > 0 ? b.sumX / b.inliers : 0;
  const cy = b.inliers > 0 ? b.sumY / b.inliers : 0;
  const cz = b.inliers > 0 ? b.sumZ / b.inliers : 0;
  const sep = Math.abs(a.nx * cx + a.ny * cy + a.nz * cz + a.d);
  return sep <= 2 * tolerance;
}

function tangentAxes(nx: number, ny: number, nz: number): [number, number, number, number, number, number] {
  const useZ = Math.abs(nz) < 0.9;
  const rx = useZ ? 0 : 1;
  const ry = 0;
  const rz = useZ ? 1 : 0;
  let ux = ry * nz - rz * ny;
  let uy = rz * nx - rx * nz;
  let uz = rx * ny - ry * nx;
  const ul = Math.hypot(ux, uy, uz);
  if (ul > ZERO_LEN) {
    ux /= ul;
    uy /= ul;
    uz /= ul;
  } else {
    ux = 1;
    uy = 0;
    uz = 0;
  }
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;
  return [ux, uy, uz, vx, vy, vz];
}

function smallestEigenvector(
  xx: number,
  xy: number,
  xz: number,
  yy: number,
  yz: number,
  zz: number,
): [number, number, number] | null {
  const a = [
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let iter = 0; iter < 24; iter += 1) {
    for (let p = 0; p < 2; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        const apq = a[p]?.[q] ?? 0;
        if (Math.abs(apq) < 1e-18) continue;
        const app = a[p]?.[p] ?? 0;
        const aqq = a[q]?.[q] ?? 0;
        const tau = (aqq - app) / (2 * apq);
        const t = tau === 0 ? 1 : Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        const rowP = a[p];
        const rowQ = a[q];
        if (rowP) rowP[p] = app - t * apq;
        if (rowQ) rowQ[q] = aqq + t * apq;
        if (rowP) rowP[q] = 0;
        if (rowQ) rowQ[p] = 0;
        for (let r = 0; r < 3; r += 1) {
          if (r === p || r === q) continue;
          const row = a[r];
          const arp = row?.[p] ?? 0;
          const arq = row?.[q] ?? 0;
          const rp = c * arp - s * arq;
          const rq = s * arp + c * arq;
          if (row) {
            row[p] = rp;
            row[q] = rq;
          }
          if (rowP) rowP[r] = rp;
          if (rowQ) rowQ[r] = rq;
        }
        for (let r = 0; r < 3; r += 1) {
          const row = v[r];
          if (!row) continue;
          const vrp = row[p] ?? 0;
          const vrq = row[q] ?? 0;
          row[p] = c * vrp - s * vrq;
          row[q] = s * vrp + c * vrq;
        }
      }
    }
  }
  const values = [a[0]?.[0] ?? 0, a[1]?.[1] ?? 0, a[2]?.[2] ?? 0];
  let smallest = 0;
  if ((values[1] ?? 0) < (values[smallest] ?? 0)) smallest = 1;
  if ((values[2] ?? 0) < (values[smallest] ?? 0)) smallest = 2;
  const largest = Math.max(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
  if (!(largest > 0)) return null;
  const ordered = [...values].sort((lhs, rhs) => lhs - rhs);
  const low = ordered[0] ?? 0;
  const mid = ordered[1] ?? 0;
  if (low < 1e-9 * largest && mid < 1e-9 * largest) return null;
  const nx = v[0]?.[smallest] ?? 0;
  const ny = v[1]?.[smallest] ?? 0;
  const nz = v[2]?.[smallest] ?? 1;
  const len = Math.hypot(nx, ny, nz);
  if (!(len > ZERO_LEN)) return null;
  return [nx / len, ny / len, nz / len];
}

function clampIndex(value: number, size: number): number {
  if (value < 0) return 0;
  if (value >= size) return size - 1;
  return value;
}
