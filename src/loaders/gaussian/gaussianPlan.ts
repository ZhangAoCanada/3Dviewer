import { FullSourceDetailError } from '../../core/sourceDetail';
import type { GaussianLoadOverrides, GaussianTextureLimits, MemoryBudget } from '../../core/types';

/** Spark's splat texture width. Packed buffers must cover a whole texture. */
export const SPLAT_TEX_WIDTH = 2048;

/**
 * Bytes of one decoded splat, not counting texture padding.
 * Packed is 4×uint32 plus SH bands (8 / 16 / 16). Extended is float32 centers
 * (2×4 uint32) plus wider SH (16 / 16 / 32).
 */
export const PACKED_SPLAT_BYTES = [16, 24, 40, 56] as const;
export const EXTENDED_SPLAT_BYTES = [32, 48, 64, 96] as const;

/** Share of MemoryBudget.cpuBytes used for the decoded buffers themselves. */
export const DECODE_FRACTION = 0.62;

/**
 * `?lod=force` builds a worker LoD tree only at or above this splat count.
 * LoD is off for every other load, even when a second copy would fit.
 */
export const LOD_ABOVE = 400_000;

export type ShDegree = 0 | 1 | 2 | 3;

export interface GaussianDecodePlan {
  shDegree: ShDegree;
  /** Keep 1 of every `stride` source splats. */
  stride: number;
  decodedCount: number;
  extended: boolean;
  /** Padded allocation, the number of bytes we will actually ask for. */
  estimatedBytes: number;
  lod: boolean;
  notes: string[];
}

export function paddedSplatCount(count: number): number {
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return 0;
  const width = SPLAT_TEX_WIDTH;
  const height = Math.max(1, Math.min(width, Math.ceil(n / width)));
  const depth = Math.ceil(n / (width * height));
  return width * height * depth;
}

export function bytesPerSplat(sh: ShDegree, extended: boolean): number {
  return extended ? EXTENDED_SPLAT_BYTES[sh] : PACKED_SPLAT_BYTES[sh];
}

export function estimateDecodedBytes(count: number, sh: ShDegree, extended: boolean): number {
  return paddedSplatCount(count) * bytesPerSplat(sh, extended);
}

/**
 * Fit a gaussian PLY into the device budget.
 * Choose encoding and SH for the resident target (the mobile cap, or the
 * full cloud), then subsample to that count. A count of 0 or 1 always fits.
 */
export function planGaussianDecode(args: {
  sourceCount: number;
  sourceSh: number;
  budget: MemoryBudget;
  preferExtended: boolean;
  overrides?: GaussianLoadOverrides;
  textureLimits?: GaussianTextureLimits;
}): GaussianDecodePlan {
  const sourceCount = Math.max(0, Math.floor(args.sourceCount));
  const sourceSh = args.sourceSh;
  if (args.overrides?.fullDetail) {
    if (sourceSh !== 0 && sourceSh !== 1 && sourceSh !== 2 && sourceSh !== 3) {
      throw new FullSourceDetailError(`Full source detail is blocked: source SH ${sourceSh} exceeds the supported SH0–3 renderer. No reduced Full scene was loaded.`);
    }
    if (!Number.isSafeInteger(args.sourceCount) || args.sourceCount < 0) {
      throw new FullSourceDetailError('Full detail cannot represent this source count safely.');
    }
    try {
      validateSplatAllocation(sourceCount, args.textureLimits);
    } catch (error) {
      throw new FullSourceDetailError(error instanceof Error ? error.message : 'Full source detail exceeds allocation limits.');
    }
    return {
      shDegree: sourceSh, stride: 1, decodedCount: sourceCount, extended: true,
      estimatedBytes: estimateDecodedBytes(sourceCount, sourceSh, true), lod: false, notes: [],
    };
  }
  const shCap = Math.min(3, sourceSh, args.budget.maxSh, args.overrides?.maxSh ?? sourceSh) as ShDegree;
  const usable = Math.floor(args.budget.cpuBytes * DECODE_FRACTION);
  const encodings = args.preferExtended ? [true, false] : [false];
  const targetCount =
    args.budget.profile === 'mobile' ? Math.min(sourceCount, args.budget.maxSplatsResident) : sourceCount;

  let shDegree: ShDegree = 0;
  let extended = false;
  let decodedCountChosen = targetCount;
  let fitted = false;

  for (const wantExtended of encodings) {
    for (let sh = shCap; sh >= 0; sh -= 1) {
      const degree = sh as ShDegree;
      if (targetCount <= 1 || estimateDecodedBytes(targetCount, degree, wantExtended) <= usable) {
        shDegree = degree;
        extended = wantExtended;
        decodedCountChosen = targetCount;
        fitted = true;
        break;
      }
    }
    if (fitted) break;
  }

  if (!fitted) {
    shDegree = 0;
    extended = false;
    decodedCountChosen = fitCount(sourceCount, 0, false, usable).count;
  }

  let stride = 1;
  let decodedCount = 0;
  if (sourceCount > 0) {
    const chosen = Math.max(1, decodedCountChosen);
    stride = Math.max(1, Math.ceil(sourceCount / chosen));
    decodedCount = Math.ceil(sourceCount / stride);
    while (decodedCount > 1 && estimateDecodedBytes(decodedCount, shDegree, extended) > usable) {
      stride += 1;
      decodedCount = Math.ceil(sourceCount / stride);
    }
  }

  validateSplatAllocation(decodedCount, args.textureLimits);
  const estimatedBytes = estimateDecodedBytes(decodedCount, shDegree, extended);
  const lod = Boolean(args.overrides?.forceLod) && decodedCount >= LOD_ABOVE;

  const notes: string[] = [];
  if (sourceSh > 3) notes.push(`Source SH ${sourceSh} exceeds the supported SH0–3 renderer; higher bands are not loaded.`);
  if (shDegree < Math.min(3, sourceSh)) {
    notes.push(
      `Spherical harmonics reduced from degree ${sourceSh} to ${shDegree} to fit the ${args.budget.profile} memory budget.`,
    );
  }
  if (args.preferExtended && !extended) {
    notes.push('Using half-float centers because float32 centers did not fit in memory.');
  }
  if (stride > 1) {
    notes.push(
      `Showing ${decodedCount.toLocaleString()} of ${sourceCount.toLocaleString()} splats (1 of every ${stride}).`,
    );
  }

  return {
    shDegree,
    stride,
    decodedCount,
    extended,
    estimatedBytes,
    lod,
    notes,
  };
}

function fitCount(
  sourceCount: number,
  sh: ShDegree,
  extended: boolean,
  usable: number,
): { count: number; stride: number } {
  if (sourceCount <= 0) return { count: 0, stride: 1 };
  let lo = 1;
  let hi = sourceCount;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (estimateDecodedBytes(mid, sh, extended) <= usable) lo = mid;
    else hi = mid - 1;
  }
  let stride = Math.max(1, Math.ceil(sourceCount / lo));
  let count = Math.ceil(sourceCount / stride);
  while (stride < sourceCount && estimateDecodedBytes(count, sh, extended) > usable) {
    stride += 1;
    count = Math.ceil(sourceCount / stride);
  }
  return { count, stride };
}

/** Spark uses fixed-width 2D array textures and Uint32 splat indices. Never a VRAM probe. */
function validateSplatAllocation(count: number, limits?: GaussianTextureLimits): void {
  const padded = paddedSplatCount(count);
  if (!Number.isSafeInteger(padded) || padded > 0xffff_ffff) {
    throw new Error('Source exceeds Spark Uint32 splat indexing/allocation limits. Use a smaller or paged scene.');
  }
  if (count === 0 || !limits) return;
  const height = Math.max(1, Math.min(SPLAT_TEX_WIDTH, Math.ceil(count / SPLAT_TEX_WIDTH)));
  const layers = Math.ceil(count / (SPLAT_TEX_WIDTH * height));
  if (SPLAT_TEX_WIDTH > limits.maxTextureSize || height > limits.maxTextureSize || layers > limits.maxArrayTextureLayers) {
    throw new Error(`Source needs a ${SPLAT_TEX_WIDTH} × ${height} × ${layers} splat texture; WebGL allows ${limits.maxTextureSize} per side and ${limits.maxArrayTextureLayers} array layers. Use a smaller or paged scene.`);
  }
}
