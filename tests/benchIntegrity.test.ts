import { afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { runBench, type BenchApp, type BenchHost } from '../src/bench/runBench';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(draw: boolean) {
  let clock = 0; let paused = false;
  const abort = new AbortController();
  const pose = { position: new THREE.Vector3(0, 0, 10), pivot: new THREE.Vector3(), up: 'y' as const, mode: 'orbit' as const };
  const host: BenchHost = { drawStamp: { count: 0, at: 0 }, lastRenderMs: 2, sortState: () => ({}), pauseDraws: (value) => { paused = value; }, stats: () => ({ gpuMemoryBytes: 0 }), navigation: { snapshot: () => pose, restore: () => {} } };
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { setImmediate(() => { clock += 16; if (draw && !paused) { host.drawStamp.count += 1; host.drawStamp.at = clock; } callback(clock); }); return 0; });
  const app: BenchApp = { onStatus: (s) => { if (s.startsWith('Waiting for')) abort.abort(); }, timings: () => ({ start: 0, added: 0, firstDraw: 1, ready: 2 }), reload: async () => true, scene: () => ({ name: 'logic fixture', kind: 'mesh', count: 1 }), environment: () => ({ build: 'unit', userAgent: 'fake', platform: 'fake', dpr: 1, viewport: 'none', software: true, preset: 'auto' }) };
  return { abort, host, app };
}
it('never reports rendered frames from a no-draw callback loop', async () => {
  const { app, host, abort } = setup(false); const report = await runBench(app, host, abort.signal);
  expect(report.frames.count).toBe(0); expect(report.renderMs.count).toBe(0);
});
it('excludes paused settle callbacks from orbit frame intervals', async () => {
  const { app, host, abort } = setup(true); const report = await runBench(app, host, abort.signal);
  expect(report.frames.count).toBeGreaterThan(1); expect(report.frames.count).toBeLessThan(251);
});
it('passes benchmark cancellation to its reload operation', async () => {
  const { app, host, abort } = setup(false);
  let received: AbortSignal | undefined;
  app.onStatus = () => {};
  app.reload = async (signal?: AbortSignal) => { received = signal; abort.abort(); return false; };
  const report = await runBench(app, host, abort.signal);
  expect(received).toBe(abort.signal); expect(report.partial).toBe(true);
});
