import { expect, it } from 'vitest';
import * as THREE from 'three';
import { MeshCollision, MAX_COLLISION_TRIANGLES } from '../src/game/meshCollision';
import { runCooperatively } from '../src/game/cooperative';
import { collisionInFrameAsync, type SceneGeometry } from '../src/game/sceneGeometry';
import { gameFrame } from '../src/game/frame';
function grid(): THREE.Triangle[] {
  const triangles: THREE.Triangle[] = [];
  for (let z = 0; z < 100; z++) for (let x = 0; x < 100; x++) {
    const a = new THREE.Vector3(x, 0, z), b = new THREE.Vector3(x + 1, 0, z), c = new THREE.Vector3(x + 1, 0, z + 1), d = new THREE.Vector3(x, 0, z + 1);
    triangles.push(new THREE.Triangle(a, d, c), new THREE.Triangle(a, c, b));
  }
  return triangles;
}
it('yields bounded work and cancels before consuming the rest of a job', async () => {
  const abort = new AbortController(); let work = 0, closed = false;
  function* units() { try { for (let i = 0; i < 1e6; i++) { work++; yield; } } finally { closed = true; } }
  await expect(runCooperatively(units(), abort.signal, async () => { abort.abort(); })).rejects.toMatchObject({ name: 'AbortError' });
  expect(work).toBeGreaterThan(0); expect(work).toBeLessThanOrEqual(2048); expect(closed).toBe(true);
});
it('lets event-loop cancellation interrupt a capped build without publishing a partial collider', async () => {
  const abort = new AbortController(); const triangles = grid(); let timerRan = false;
  setTimeout(() => { timerRan = true; abort.abort(); }, 0);
  await expect(MeshCollision.create(triangles, abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  expect(timerRan).toBe(true);
});
it('keeps all capped collision surfaces after asynchronous transformed-coordinate preparation', async () => {
  const triangles = grid(), anchor = new THREE.Vector3(4e6, 7, 3e6);
  const geometry: SceneGeometry = { anchor, bounds: new THREE.Box3(anchor, anchor.clone().add(new THREE.Vector3(100, 0, 100))), positions: new Float32Array(), provenance: 'mesh-surface', triangles, collisionReason: '' };
  expect(triangles).toHaveLength(MAX_COLLISION_TRIANGLES);
  const collider = await collisionInFrameAsync(geometry, gameFrame(anchor, new THREE.Vector3(0, 1, 0)), new AbortController().signal);
  expect(collider).not.toBeNull();
  for (const x of [.25, 25.25, 50.25, 99.25]) for (const z of [.25, 50.25, 99.25]) {
    collider!.beginFrame(); expect(collider!.support(x, z, .1, .2).kind).toBe('hit');
  }
});
it('rejects an already cancelled request or invalid geometry, never treating either as empty space', async () => {
  const abort = new AbortController(); abort.abort();
  await expect(MeshCollision.create(grid(), abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  const invalid = new THREE.Triangle(new THREE.Vector3(NaN, 0, 0), new THREE.Vector3(), new THREE.Vector3(1, 0, 0));
  await expect(MeshCollision.create([invalid], new AbortController().signal)).rejects.toThrow('Invalid collision');
});
