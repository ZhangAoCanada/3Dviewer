import { shReductionText } from '../core/sourceDetail';
import type { RenderableStats } from '../core/types';

export interface DetailState {
  reduced: boolean;
  retained: number;
  source: number;
  activeSh?: number;
  sourceSh?: number;
  reasons: string[];
}

/** Why the loaded scene is showing less than the file, in display order. */
export function detailOf(
  stats: RenderableStats[],
  renderSh: number,
  pixel: { used: number; automatic: number },
): DetailState {
  let retained = 0;
  let source = 0;
  let loadedSh: number | undefined;
  let sourceSh: number | undefined;
  let precision = false;
  let points = 0;
  let others = 0;
  let sawDetail = false;

  for (const item of stats) {
    const detail = item.detail;
    if (!detail) continue;
    sawDetail = true;
    retained += detail.retainedCount;
    source += detail.sourceCount;
    if (detail.loadedSh != null) loadedSh = loadedSh == null ? detail.loadedSh : Math.min(loadedSh, detail.loadedSh);
    if (detail.sourceSh != null) sourceSh = sourceSh == null ? detail.sourceSh : Math.min(sourceSh, detail.sourceSh);
    if (detail.precisionReduced) precision = true;
    if (item.kind === 'points') points += 1;
    else others += 1;
  }

  if (!sawDetail) {
    return { reduced: false, retained: 0, source: 0, reasons: [] };
  }

  const noun = others === 0 && points > 0 ? 'points' : 'splats';
  const reasons: string[] = [];
  if (retained < source) {
    reasons.push(`Showing ${formatDetailCount(retained)} of ${formatDetailCount(source)} ${noun}`);
  }
  if (loadedSh != null && sourceSh != null && loadedSh < sourceSh) {
    reasons.push(shReductionText(loadedSh, sourceSh, stats.length === 1 ? stats[0]?.detail?.shReduction : undefined));
  }
  if (loadedSh != null && renderSh < loadedSh) {
    reasons.push(`Rendering SH ${renderSh} (set in Settings)`);
  }
  if (precision) reasons.push('Half-float centers to fit memory');
  if (pixel.used < pixel.automatic) {
    reasons.push(`Pixel ratio ${formatRatio(pixel.used)} instead of ${formatRatio(pixel.automatic)}`);
  }

  return {
    reduced: reasons.length > 0,
    retained,
    source,
    activeSh: loadedSh == null ? undefined : Math.min(renderSh, loadedSh),
    sourceSh,
    reasons,
  };
}

/** Actual loaded state only; selecting a request must never make this claim Full. */
export function loadedDetailSummary(stats: RenderableStats | undefined, state: DetailState, fullSourceLoaded: boolean): { label: string; reason: string } {
  if (!stats) return { label: 'No scene yet', reason: 'Open a scene to see its actual loaded detail.' };
  if (state.reduced) return { label: 'Reduced detail', reason: detailText(state) };
  const detail = stats.detail;
  if (detail?.sourceSh != null) return {
    label: fullSourceLoaded ? 'Full source detail' : 'Full supported detail',
    reason: `${detail.retainedCount.toLocaleString()} of ${detail.sourceCount.toLocaleString()} splats · SH ${state.activeSh} of ${detail.sourceSh} · ${stats.extra?.encoding ?? 'encoding unknown'}. Not lossless source precision.`,
  };
  if (stats.kind === 'splats') return { label: 'Source detail unknown', reason: 'Spark decoded this format; source SH/count preservation is not verified here.' };
  const kind = stats.kind === 'mesh' ? 'Mesh' : stats.kind === 'points' ? 'Point cloud' : 'Scene';
  return { label: `${kind} loaded`, reason: `${stats.primitives.toLocaleString()} primitives. Quality presets affect pixel ratio, not source geometry.` };
}

/** Badge title body. Reasons joined with a middle dot. */
export function detailText(state: DetailState): string {
  return state.reasons.join(' · ');
}

/** Scene row: "Full", or a shorter form of the same reasons. */
export function detailSceneText(state: DetailState): string {
  if (!state.reduced) return 'Full';
  const parts = state.reasons.map((reason) => {
    if (reason.startsWith('Showing ')) return reason.slice('Showing '.length);
    return reason;
  });
  return `Reduced: ${parts.join(' · ')}`;
}

function formatDetailCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function formatRatio(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return String(Number(value.toFixed(2)));
}
