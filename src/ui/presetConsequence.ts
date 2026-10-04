import { EXTENDED_BYTES } from '../loaders/gaussian/gaussianLoader';
import { planGaussianDecode, type ShDegree } from '../loaders/gaussian/gaussianPlan';
import type { MemoryBudget, QualityPreset, RepresentationKind } from '../core/types';
import { resolvePreset } from '../core/qualityPreset';

/** Counts and harmonics for the loaded scene. Built from stats when Batch B's detail is absent. */
export interface PresetSceneDetail {
  sourceCount: number;
  retainedCount: number;
  sourceSh?: number;
  loadedSh?: number;
}

export interface PresetConsequenceInput {
  preset: QualityPreset;
  loadedPreset: QualityPreset | null;
  kind: RepresentationKind | null;
  detail?: PresetSceneDetail | null;
  /** File size. Gaussian PLY uses it to choose float32 centers. */
  bytes?: number;
  budget: MemoryBudget;
}

/**
 * One sentence about what the selected preset does to the open scene.
 * Nothing loaded returns null.
 */
export function presetConsequence(input: PresetConsequenceInput): string | null {
  const { preset, loadedPreset, kind, detail, bytes, budget } = input;
  if (kind == null) return null;
  if (kind === 'mesh') return 'Presets only change the pixel ratio for meshes.';
  if (kind === 'points') {
    const count = detail?.sourceCount ?? detail?.retainedCount ?? 0;
    return `This point cloud: ${formatGrouped(count)} points, all shown.`;
  }
  if (kind !== 'splats') return null;
  if (detail == null) return 'This file is decoded by Spark, so only the rendered SH and pixel ratio change.';

  const sourceSh = asSh(detail.sourceSh ?? detail.loadedSh ?? 3);
  const loaded = decodeFor(loadedPreset ?? preset, detail.sourceCount, sourceSh, bytes, budget);
  let text = `This scan: ${formatGrouped(detail.sourceCount)} splats at SH ${loaded.shDegree} of ${sourceSh}, about ${aboutBytes(loaded.estimatedBytes)}.`;
  if (loadedPreset != null && preset !== loadedPreset) {
    const next = decodeFor(preset, detail.sourceCount, sourceSh, bytes, budget);
    const same =
      next.shDegree === loaded.shDegree &&
      next.estimatedBytes === loaded.estimatedBytes &&
      next.stride === loaded.stride &&
      next.extended === loaded.extended &&
      next.decodedCount === loaded.decodedCount;
    text += same
      ? ' Reopening would not change this scan.'
      : ` Reopen to apply: SH ${next.shDegree} of ${sourceSh}, about ${aboutBytes(next.estimatedBytes)}.`;
  }
  return text;
}

function decodeFor(
  preset: QualityPreset,
  sourceCount: number,
  sourceSh: ShDegree,
  bytes: number | undefined,
  budget: MemoryBudget,
) {
  const plan = resolvePreset(preset, budget);
  const preferExtended = plan.extendedPrecision || (bytes ?? 0) >= EXTENDED_BYTES;
  return planGaussianDecode({
    sourceCount,
    sourceSh,
    budget: plan.budget,
    preferExtended,
    overrides: plan.overrides,
  });
}

function asSh(value: number): ShDegree {
  if (value <= 0) return 0;
  if (value === 1) return 1;
  if (value === 2) return 2;
  return 3;
}

function formatGrouped(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** Decimal size, matching "1.07 GB" and "805 MB". */
export function aboutBytes(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
  if (bytes >= 1_000_000) {
    const mb = bytes / 1_000_000;
    return mb >= 10 ? `${Math.round(mb)} MB` : `${mb.toFixed(1)} MB`;
  }
  if (bytes >= 1000) {
    const kb = bytes / 1000;
    return kb >= 10 ? `${Math.round(kb)} KB` : `${kb.toFixed(1)} KB`;
  }
  return `${Math.round(bytes)} B`;
}
