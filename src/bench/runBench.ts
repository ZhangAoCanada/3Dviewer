import * as THREE from 'three';
import type { NavSnapshot } from '../render/Navigation';
import {
  BENCH_NOTE,
  formatBenchMarkdown,
  summarizeFrames,
  type BenchReport,
  type LoadTimings,
  type ReloadSample,
} from './benchStats';

export interface BenchSceneView {
  name: string;
  kind: string;
  bytes?: number;
  count: number;
  sourceCount?: number;
  sh?: string;
}

export interface BenchEnvironment {
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
}

/** The slice of the viewer the benchmark is allowed to drive. */
export interface BenchApp {
  onStatus(text: string): void;
  timings(): LoadTimings;
  /** Reload the open scene. Resolves true when the new scene is on screen. */
  reload(): Promise<boolean>;
  scene(): BenchSceneView | null;
  environment(): BenchEnvironment;
}

export interface BenchHost {
  drawStamp: { count: number; at: number };
  lastRenderMs: number;
  sortState(): { sorting?: boolean; lastSortTime?: number };
  pauseDraws?(paused: boolean): void;
  /** Drop a follow-up sort queued behind the one already reading back. */
  dropQueuedSort?(): void;
  stats(): { gpuMemoryBytes: number };
  navigation: {
    snapshot(): NavSnapshot;
    restore(snapshot: NavSnapshot): void;
  };
}

interface MemoryProbe {
  usedJSHeapSize?: number;
}

const ORBIT_MS = 6000;
const SETTLE_MS = 30_000;
const READY_WAIT_MS = 15_000;
const HEAP_AFTER_READY_MS = 2000;

/**
 * Orbit, sort, memory, and three reloads. Stops early, with a partial report,
 * when `signal` aborts or the page is hidden.
 */
export async function runBench(app: BenchApp, host: BenchHost, signal: AbortSignal): Promise<BenchReport> {
  const env = app.environment();
  const scene = app.scene() ?? { name: 'Nothing loaded', kind: 'none', count: 0 };
  const before = host.navigation.snapshot();
  const cameraBefore = pose(before);
  let stopped: string | undefined;
  const halt = (): boolean => {
    if (signal.aborted) {
      stopped = 'aborted';
      return true;
    }
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      stopped = 'hidden';
      return true;
    }
    return false;
  };

  const heap = startHeapProbe();
  let frames = summarizeFrames([]);
  let renderMs = summarizeFrames([]);
  let sortSettleMs: number | null = null;
  const boot = deltaTimings(await waitForMarks(app, signal, READY_WAIT_MS));

  if (!halt()) {
    app.onStatus('Orbiting… 0 s');
    const orbit = await scriptedOrbit(app, host, before, signal, halt);
    frames = summarizeFrames(orbit.deltas);
    renderMs = summarizeFrames(orbit.renderMs);
    if (!halt() && !orbit.stopped) {
      app.onStatus('Waiting for the sort to settle…');
      sortSettleMs = await settleHomeSort(host, before, signal, halt);
    } else {
      host.pauseDraws?.(false);
    }
  }

  const reloads: ReloadSample[] = [];
  if (!halt()) {
    for (let i = 0; i < 3; i += 1) {
      if (halt()) break;
      app.onStatus(`Reloading ${i + 1} of 3…`);
      reloads.push(await oneReload(app, host, signal, halt));
    }
  }

  host.navigation.restore(before);
  const after = host.navigation.snapshot();
  heap.stop();
  const specific = await userAgentMemory();
  const growth = heapGrowth(reloads);
  const report: BenchReport = {
    schema: 'omniview-bench/1',
    partial: stopped != null,
    note: BENCH_NOTE,
    build: env.build,
    userAgent: env.userAgent,
    platform: env.platform,
    dpr: env.dpr,
    viewport: env.viewport,
    software: env.software,
    preset: env.preset,
    scene,
    firstDrawMs: boot.firstDrawMs,
    readyMs: boot.readyMs,
    frames,
    renderMs,
    sortSettleMs,
    memory: {
      source: heap.source,
      heapPeak: heap.peak,
      gpuMemoryBytes: host.stats().gpuMemoryBytes,
      userAgentSpecificBytes: specific,
      wasm: null,
      wasmReason: 'not exposed by Spark',
    },
    reloads,
    heapGrowth: growth,
    camera: { before: cameraBefore, after: pose(after) },
  };
  if (env.deviceMemory != null) report.deviceMemory = env.deviceMemory;
  if (env.cores != null) report.cores = env.cores;
  if (env.renderer) report.renderer = env.renderer;
  if (stopped) report.stopped = stopped;
  if (!stopped) app.onStatus('Done.');
  else app.onStatus(stopped === 'hidden' ? 'Stopped. The page was hidden.' : 'Stopped.');
  return report;
}

export { formatBenchMarkdown };

function pose(snapshot: NavSnapshot): { position: number[]; pivot: number[] } {
  return {
    position: [snapshot.position.x, snapshot.position.y, snapshot.position.z],
    pivot: [snapshot.pivot.x, snapshot.pivot.y, snapshot.pivot.z],
  };
}

function deltaTimings(timings: LoadTimings): { firstDrawMs: number | null; readyMs: number | null } {
  return {
    firstDrawMs: timings.firstDraw == null ? null : timings.firstDraw - timings.start,
    readyMs: timings.ready == null ? null : timings.ready - timings.start,
  };
}

async function waitForMarks(app: BenchApp, signal: AbortSignal, timeoutMs: number): Promise<LoadTimings> {
  const started = performance.now();
  let timings = app.timings();
  while (timings.firstDraw == null || timings.ready == null) {
    if (signal.aborted || performance.now() - started > timeoutMs) break;
    await nextFrame();
    timings = app.timings();
  }
  return timings;
}

async function oneReload(
  app: BenchApp,
  host: BenchHost,
  signal: AbortSignal,
  halt: () => boolean,
): Promise<ReloadSample> {
  let ok = false;
  try {
    ok = await app.reload();
  } catch {
    ok = false;
  }
  // One readback at a time. A frame during the read sets sortDirty, and Spark
  // starts that follow-up the moment the fence signals, so Ready never lands.
  if (app.scene()?.kind === 'splats') await holdInFlightSort(host, signal, halt);
  let timings: LoadTimings;
  try {
    timings = await waitForMarks(app, signal, READY_WAIT_MS);
  } finally {
    host.pauseDraws?.(false);
  }
  const delta = deltaTimings(timings);
  const settled = timings.ready != null;
  if (settled && !halt()) await delay(HEAP_AFTER_READY_MS, signal);
  return {
    firstDrawMs: delta.firstDrawMs,
    readyMs: delta.readyMs,
    ok: ok && timings.firstDraw != null && timings.ready != null,
    heap: readHeap(),
  };
}

function heapGrowth(reloads: readonly ReloadSample[]): number | null {
  const first = reloads[0]?.heap;
  const last = reloads[reloads.length - 1]?.heap;
  if (reloads.length < 2 || first == null || last == null) return null;
  return last - first;
}

async function scriptedOrbit(
  app: BenchApp,
  host: BenchHost,
  base: NavSnapshot,
  signal: AbortSignal,
  halt: () => boolean,
): Promise<{ deltas: number[]; renderMs: number[]; sortMark: number | undefined; stopped: boolean }> {
  const deltas: number[] = [];
  const renderMs: number[] = [];
  let seen = host.drawStamp.count;
  const t0 = performance.now();
  let last = t0;
  let sortMark = host.sortState().lastSortTime;
  let stopped = false;
  await new Promise<void>((resolve) => {
    const step = (now: number) => {
      if (halt()) {
        stopped = true;
        sortMark = host.sortState().lastSortTime;
        host.pauseDraws?.(false);
        resolve();
        return;
      }
      deltas.push(now - last);
      last = now;
      const elapsed = now - t0;
      if (elapsed >= ORBIT_MS) {
        sortMark = host.sortState().lastSortTime;
        resolve();
        return;
      }
      // Turn over the first 4 s, then stop submitting frames so the in-flight
      // readback can finish without another one queued behind it.
      const moveMs = ORBIT_MS - 2000;
      if (elapsed < moveMs) host.navigation.restore(rotated(base, elapsed / moveMs));
      else holdSort(host);
      if (host.drawStamp.count !== seen) {
        seen = host.drawStamp.count;
        renderMs.push(host.lastRenderMs);
      }
      app.onStatus(`Orbiting… ${Math.max(0, Math.round(elapsed / 1000))} s`);
      if (signal.aborted) {
        stopped = true;
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  return { deltas, renderMs, sortMark, stopped };
}

function rotated(base: NavSnapshot, turns: number): NavSnapshot {
  const axis = base.up === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const offset = base.position.clone().sub(base.pivot);
  offset.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(axis, turns * Math.PI * 2));
  offset.add(base.pivot);
  return {
    position: offset,
    pivot: base.pivot.clone(),
    up: base.up,
    mode: base.mode,
  };
}

/**
 * Put the camera back, then wait until the one sort that readback starts has
 * finished. Draws stay paused around each readback so SwiftShader is not asked
 * to chain another fence behind it. Returns null when the wait is aborted or
 * the fence does not signal within 30 s.
 */
async function settleHomeSort(
  host: BenchHost,
  before: NavSnapshot,
  signal: AbortSignal,
  halt: () => boolean,
): Promise<number | null> {
  const started = performance.now();
  const deadline = started + SETTLE_MS;
  holdSort(host);
  try {
    if (!(await waitSortIdle(host, signal, halt, deadline))) return null;
    host.pauseDraws?.(false);
    const mark = host.sortState().lastSortTime;
    host.navigation.restore(before);
    if (!(await waitSortKicked(host, mark, signal, halt, deadline))) return null;
    holdSort(host);
    if (!(await waitSortIdle(host, signal, halt, deadline))) return null;
    return performance.now() - started;
  } finally {
    host.pauseDraws?.(false);
  }
}

/** Pause draws and forget a sort that would start the moment this readback ends. */
function holdSort(host: BenchHost): void {
  host.pauseDraws?.(true);
  host.dropQueuedSort?.();
}

async function waitSortIdle(
  host: BenchHost,
  signal: AbortSignal,
  halt: () => boolean,
  deadline: number,
): Promise<boolean> {
  while (performance.now() < deadline) {
    if (halt() || signal.aborted) return false;
    if (host.sortState().sorting !== true) return true;
    await nextFrame();
  }
  return false;
}

/**
 * After the camera jump, give the renderer a couple of frames to start the
 * readback. Idle with an unchanged timestamp means the view did not need one.
 */
async function waitSortKicked(
  host: BenchHost,
  mark: number | undefined,
  signal: AbortSignal,
  halt: () => boolean,
  deadline: number,
): Promise<boolean> {
  let frames = 0;
  while (performance.now() < deadline && frames < 8) {
    if (halt() || signal.aborted) return false;
    await nextFrame();
    frames += 1;
    const state = host.sortState();
    if (state.sorting === true) return true;
    if (state.lastSortTime !== mark) return true;
    if (frames >= 2) return true;
  }
  return !halt() && !signal.aborted;
}

/**
 * The reload's first frame starts the new scene's sort. Freeze follow-ups
 * once that readback is in flight so Ready is that sort, not a chain of them.
 */
async function holdInFlightSort(host: BenchHost, signal: AbortSignal, halt: () => boolean): Promise<void> {
  const mark = host.sortState().lastSortTime;
  let frames = 0;
  while (frames < 8) {
    if (halt() || signal.aborted) return;
    const state = host.sortState();
    if (state.sorting === true) {
      holdSort(host);
      return;
    }
    // Idle already, or this renderer does not report a sort flag.
    if (state.lastSortTime !== mark || frames >= 2) return;
    await nextFrame();
    frames += 1;
  }
}

function startHeapProbe(): {
  source: 'performance.memory' | 'none';
  peak: number | null;
  stop: () => void;
} {
  const probe = memoryProbe();
  let peak: number | null = probe;
  const timer = setInterval(() => {
    const next = memoryProbe();
    if (next == null) return;
    peak = peak == null ? next : Math.max(peak, next);
  }, 250);
  return {
    source: typeof performance !== 'undefined' && memoryObject() ? 'performance.memory' : 'none',
    get peak() {
      return peak;
    },
    stop() {
      clearInterval(timer);
    },
  };
}

function memoryObject(): MemoryProbe | undefined {
  const memory = (performance as Performance & { memory?: MemoryProbe }).memory;
  return memory;
}

function memoryProbe(): number | null {
  const used = memoryObject()?.usedJSHeapSize;
  return typeof used === 'number' && Number.isFinite(used) ? used : null;
}

function readHeap(): number | null {
  return memoryProbe();
}

async function userAgentMemory(): Promise<number | null> {
  if (typeof crossOriginIsolated === 'undefined' || !crossOriginIsolated) return null;
  const measure = (
    performance as Performance & { measureUserAgentSpecificMemory?: () => Promise<{ bytes?: number }> }
  ).measureUserAgentSpecificMemory;
  if (!measure) return null;
  try {
    const result = await measure.call(performance);
    return typeof result.bytes === 'number' ? result.bytes : null;
  } catch {
    return null;
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
