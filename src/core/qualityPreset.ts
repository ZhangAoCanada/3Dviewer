import type { ShDegree } from '../loaders/gaussian/gaussianPlan';
import type { GaussianLoadOverrides, MemoryBudget, QualityPreset, RenderSettings } from './types';

export type { QualityPreset };

export interface PresetPlan {
  /** Decode budget. Automatic returns the same object that was passed in. */
  budget: MemoryBudget;
  overrides?: GaussianLoadOverrides;
  renderSh: ShDegree;
  pixelRatio: RenderSettings['pixelRatio'];
  extendedPrecision: boolean;
  /** When true, drop the previous scene before decode, even for a small file. */
  alwaysPreClear: boolean;
  /** One plain sentence for the Quality control. */
  summary: string;
  /** The technical line, shown behind Details. */
  details: string;
}

const PRESETS = new Set<QualityPreset>(['auto', 'quality', 'memory']);

/** Stored `3dviewer-quality` values. Anything else is Automatic. */
export function parseQualityPreset(value: unknown): QualityPreset {
  return typeof value === 'string' && PRESETS.has(value as QualityPreset) ? (value as QualityPreset) : 'auto';
}

/**
 * Map a preset onto today's memory budget.
 * Automatic returns `budget` unchanged and sets no overrides, so a desktop load
 * matches the policy that shipped before presets existed.
 */
export function resolvePreset(preset: QualityPreset, budget: MemoryBudget): PresetPlan {
  if (preset === 'quality') return betterQuality(budget);
  if (preset === 'memory') return lowerMemory(budget);
  return {
    budget,
    overrides: undefined,
    renderSh: budget.maxSh,
    pixelRatio: 'auto',
    extendedPrecision: false,
    alwaysPreClear: false,
    summary: 'Automatic balances detail and memory for this device. Some changes require reopening the file.',
    details: `${deviceLabel(budget)} · up to SH ${budget.maxSh} · level of detail off. ${SPARK_HINT}`,
  };
}

/**
 * Combine preset decode overrides with URL `?sh=` / `?lod=force`.
 * URL values win. Lower memory still drops `forceLod`: a second LoD copy never reduces memory.
 */
export function mergePresetOverrides(
  preset: QualityPreset,
  plan: Pick<PresetPlan, 'overrides'>,
  url: GaussianLoadOverrides | undefined,
): GaussianLoadOverrides | undefined {
  const merged: GaussianLoadOverrides = { ...plan.overrides, ...url };
  if (preset === 'memory') delete merged.forceLod;
  if (merged.forceLod !== true && merged.maxSh == null) return undefined;
  return merged;
}

const SPARK_HINT =
  'Compressed formats (.spz, .sog, .splat, .ksplat, .rad) only change rendered harmonics, pixel ratio, and pre-clear, because Spark decodes them. A paged .rad is the bounded-memory route.';

function betterQuality(budget: MemoryBudget): PresetPlan {
  const next: MemoryBudget = { ...budget, maxSh: 3 };
  const mobile = budget.profile === 'mobile';
  const stepDown =
    'Harmonics still step down to fit memory, so a large scan keeps float32 centers instead of falling back to half-float SH 3.';
  const cost = mobile ? ' Pixel ratio 2 and SH 3 use more GPU fill than Automatic.' : '';
  return {
    budget: next,
    overrides: undefined,
    renderSh: 3,
    pixelRatio: mobile ? '2' : 'auto',
    extendedPrecision: true,
    alwaysPreClear: false,
    summary: 'Better quality keeps more detail and uses more memory. Some changes require reopening the file.',
    details: `${deviceLabel(budget)} · up to SH 3 · ${mobile ? 'pixel ratio 2 · ' : ''}float32 centers · level of detail off. ${stepDown}${cost} ${SPARK_HINT}`,
  };
}

function lowerMemory(budget: MemoryBudget): PresetPlan {
  const mobile = budget.profile === 'mobile';
  const cap: ShDegree = mobile ? 0 : 1;
  const next: MemoryBudget = {
    ...budget,
    cpuBytes: budget.cpuBytes * 0.7,
    maxSplatsResident: mobile ? Math.floor(budget.maxSplatsResident * 0.6) : budget.maxSplatsResident,
  };
  return {
    budget: next,
    overrides: { maxSh: cap },
    renderSh: cap,
    pixelRatio: '1',
    extendedPrecision: false,
    alwaysPreClear: true,
    summary: 'Lower memory keeps less detail so large scenes fit. Some changes require reopening the file.',
    details: `${deviceLabel(budget)} · up to SH ${cap} · pixel ratio 1 · level of detail off. The previous scene is cleared before decode, and level of detail is never built. ${SPARK_HINT}`,
  };
}

function deviceLabel(budget: MemoryBudget): string {
  return budget.profile === 'mobile' ? 'Mobile' : 'Desktop';
}
