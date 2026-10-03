/** Timestamps from one load. `start` is set when the loading clock begins. */
export interface LoadTimings {
  start: number;
  added: number | null;
  firstDraw: number | null;
  ready: number | null;
}

export interface FrameSummary {
  count: number;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  max: number | null;
  /** Samples strictly above 33 ms. */
  over33: number;
}

export interface ReloadSample {
  firstDrawMs: number | null;
  readyMs: number | null;
  ok: boolean;
  heap: number | null;
}

export interface BenchReport {
  schema: 'omniview-bench/1';
  partial: boolean;
  stopped?: string;
  note: string;
  build: string;
  userAgent: string;
  platform: string;
  deviceMemory?: number;
  cores?: number;
  dpr: number;
  viewport: string;
  renderer?: string;
  software: boolean;
  preset: string;
  scene: {
    name: string;
    kind: string;
    bytes?: number;
    count: number;
    sourceCount?: number;
    sh?: string;
  };
  firstDrawMs: number | null;
  readyMs: number | null;
  frames: FrameSummary;
  renderMs: FrameSummary;
  sortSettleMs: number | null;
  memory: {
    source: 'performance.memory' | 'none';
    heapPeak: number | null;
    gpuMemoryBytes: number | null;
    userAgentSpecificBytes: number | null;
    wasm: null;
    wasmReason: 'not exposed by Spark';
  };
  reloads: ReloadSample[];
  heapGrowth: number | null;
  camera: {
    before: { position: number[]; pivot: number[] };
    after: { position: number[]; pivot: number[] };
  };
}

export const BENCH_NOTE =
  'Frame times measure render and sort only. Orbiting through restore() skips input handling and inertia.';

/**
 * Nearest-rank percentile. `sorted` must be ascending.
 * Rank is `ceil(p/100 * n)`, clamped into the array.
 */
export function percentile(sorted: readonly number[], p: number): number | null {
  const n = sorted.length;
  if (n === 0) return null;
  const rank = Math.ceil((p / 100) * n);
  const index = Math.min(n, Math.max(1, rank)) - 1;
  return sorted[index] ?? null;
}

export function summarizeFrames(deltas: readonly number[]): FrameSummary {
  if (deltas.length === 0) {
    return { count: 0, p50: null, p90: null, p99: null, max: null, over33: 0 };
  }
  const sorted = [...deltas].sort((a, b) => a - b);
  let over33 = 0;
  for (const value of deltas) {
    if (value > 33) over33 += 1;
  }
  return {
    count: deltas.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? null,
    over33,
  };
}

function cell(value: string): string {
  return value.replace(/\|/g, '/').replace(/\n/g, ' ');
}

function num(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return digits === 0 ? String(Math.round(value)) : value.toFixed(digits);
}

function frameRows(prefix: string, summary: FrameSummary): [string, string][] {
  return [
    [`${prefix} count`, num(summary.count, 0)],
    [`${prefix} p50`, num(summary.p50)],
    [`${prefix} p90`, num(summary.p90)],
    [`${prefix} p99`, num(summary.p99)],
    [`${prefix} max`, num(summary.max)],
    [`${prefix} over 33 ms`, num(summary.over33, 0)],
  ];
}

/** One table row for every report field. */
export function formatBenchMarkdown(report: BenchReport): string {
  const scene = report.scene;
  const memory = report.memory;
  const rows: [string, string][] = [
    ['Schema', report.schema],
    ['Partial', report.partial ? 'yes' : 'no'],
    ['Stopped', report.stopped ?? '—'],
    ['Build', report.build],
    ['User agent', report.userAgent || 'unknown'],
    ['Platform', report.platform || 'unknown'],
    ['Device memory', report.deviceMemory == null ? 'unknown' : `${report.deviceMemory} GB`],
    ['CPU cores', report.cores == null ? 'unknown' : String(report.cores)],
    ['Pixel ratio', num(report.dpr)],
    ['Viewport', report.viewport],
    ['Renderer', report.renderer ?? '—'],
    ['Software renderer', report.software ? 'yes' : 'no'],
    ['Preset', report.preset],
    ['Scene', scene.name],
    ['Kind', scene.kind],
    ['Size', scene.bytes == null ? '—' : String(scene.bytes)],
    ['Count', String(scene.count)],
    ['Source count', scene.sourceCount == null ? '—' : String(scene.sourceCount)],
    ['SH', scene.sh ?? '—'],
    ['First frame', num(report.firstDrawMs)],
    ['Ready', num(report.readyMs)],
    ...frameRows('Frame', report.frames),
    ...frameRows('Render', report.renderMs),
    ['Sort settle', num(report.sortSettleMs)],
    ['Heap source', memory.source],
    ['Heap peak', num(memory.heapPeak, 0)],
    ['GPU memory', num(memory.gpuMemoryBytes, 0)],
    ['User-agent memory', num(memory.userAgentSpecificBytes, 0)],
    ['WASM', memory.wasmReason],
    ['Heap growth', num(report.heapGrowth, 0)],
    ['Camera before', report.camera.before.position.map((n) => n.toFixed(6)).join(', ')],
    ['Camera after', report.camera.after.position.map((n) => n.toFixed(6)).join(', ')],
    ['Pivot before', report.camera.before.pivot.map((n) => n.toFixed(6)).join(', ')],
    ['Pivot after', report.camera.after.pivot.map((n) => n.toFixed(6)).join(', ')],
  ];
  for (let i = 0; i < 3; i += 1) {
    const sample = report.reloads[i];
    const value = sample
      ? `${sample.ok ? 'ok' : 'failed'} · first ${num(sample.firstDrawMs)} · ready ${num(sample.readyMs)} · heap ${num(sample.heap, 0)}`
      : '—';
    rows.push([`Reload ${i + 1}`, value]);
  }
  rows.push(['Note', report.note]);
  const body = rows.map(([key, value]) => `| ${cell(key)} | ${cell(value)} |`).join('\n');
  return `# Omniview benchmark\n\n| Field | Value |\n| --- | --- |\n${body}\n`;
}

export const BENCH_MARKDOWN_FIELDS = [
  'Schema',
  'Partial',
  'Stopped',
  'Build',
  'User agent',
  'Platform',
  'Device memory',
  'CPU cores',
  'Pixel ratio',
  'Viewport',
  'Renderer',
  'Software renderer',
  'Preset',
  'Scene',
  'Kind',
  'Size',
  'Count',
  'Source count',
  'SH',
  'First frame',
  'Ready',
  'Frame count',
  'Frame p50',
  'Frame p90',
  'Frame p99',
  'Frame max',
  'Frame over 33 ms',
  'Render count',
  'Render p50',
  'Render p90',
  'Render p99',
  'Render max',
  'Render over 33 ms',
  'Sort settle',
  'Heap source',
  'Heap peak',
  'GPU memory',
  'User-agent memory',
  'WASM',
  'Heap growth',
  'Camera before',
  'Camera after',
  'Pivot before',
  'Pivot after',
  'Reload 1',
  'Reload 2',
  'Reload 3',
  'Note',
] as const;
