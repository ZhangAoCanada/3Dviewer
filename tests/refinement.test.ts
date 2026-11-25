import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SceneHost } from '../src/render/SceneHost';
import { SplatIndexJob } from '../src/render/splatIndex';

// Isolate the real host lifecycle/query methods from the WebGL constructor.
// Real index jobs are pumped cooperatively below, never mocked as completed.
function hostState() {
  const lifecycle: { indexJob: SplatIndexJob | null; pendingIndexBox: THREE.Box3 | null; indexAfter: number } = {
    indexJob: null, pendingIndexBox: new THREE.Box3(), indexAfter: 600,
  };
  return Object.assign(lifecycle, {
    renderables: [], content: new THREE.Group(),
    game: { invalidate() {} },
    sortTimer: { reset() {} },
    pagerPending: () => false, sortingPending: () => false,
    rebuildPickMeshes() {},
  });
}
function sample(state: ReturnType<typeof hostState>): unknown {
  return Reflect.apply(SceneHost.prototype.refinement, state, []);
}

describe('scene refinement includes scheduled work', () => {
  it('does not report Ready in the orientation debounce gap before an index job exists', () => {
    const state = hostState();
    expect(sample(state)).toEqual({ pending: true, index: 0, paging: false, sorting: false });
    // Waiting longer does not make already-scheduled work disappear.
    state.indexAfter = 1;
    expect(sample(state)).toMatchObject({ pending: true, index: 0 });
  });

  it('stays pending from queued through slow real index pumping, then settles once', () => {
    const state = hostState();
    const positions = new Float32Array(120_000);
    for (let i = 0; i < positions.length; i += 1) positions[i] = Math.sin(i) * 10;
    expect(sample(state)).toMatchObject({ pending: true, index: 0 });
    const job = SplatIndexJob.fromPositions(positions);
    state.pendingIndexBox = null; state.indexAfter = 0; state.indexJob = job;
    let turns = 0;
    while (!job.pump(0)) {
      expect(sample(state)).toMatchObject({ pending: true, index: job.progress });
      turns += 1;
      expect(turns).toBeLessThan(1000);
    }
    expect(turns).toBeGreaterThan(1);
    job.finish(); state.indexJob = null;
    expect(sample(state)).toEqual({ pending: false, index: null, paging: false, sorting: false });
  });

  it.each(['queued', 'running'])('clear/new-scene boundary drops %s work, including abandoned job progress', (phase) => {
    const state = hostState();
    const oldJob = SplatIndexJob.fromPositions(new Float32Array(60_000));
    if (phase === 'running') { state.pendingIndexBox = null; state.indexAfter = 0; state.indexJob = oldJob; }
    Reflect.apply(SceneHost.prototype.clear, state, []);
    expect(sample(state)).toMatchObject({ pending: false, index: null });
    oldJob.pump(0);
    expect(sample(state)).toMatchObject({ pending: false, index: null });
    state.pendingIndexBox = new THREE.Box3(); state.indexAfter = 1200;
    expect(sample(state)).toMatchObject({ pending: true, index: 0 });
  });
});
