import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MeshRenderable } from '../src/renderables/meshRenderable';
import { GaussianRenderable } from '../src/renderables/gaussianRenderable';
import { prepareSceneGeometry, collisionInFrame, MAX_GROUND_SAMPLES } from '../src/game/sceneGeometry';
import { gameFrame, playerScale } from '../src/game/frame';
import { toHalf } from '../src/loaders/gaussian/packSplat';
import type { Renderable } from '../src/core/types';
const meta = { fileName: 'fixture.glb', loaderId: 'mesh', loadMs: 0 };
const signal = () => new AbortController().signal;
const floor = () => new THREE.Mesh(new THREE.PlaneGeometry(10, 10).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial());
function renderable(root: THREE.Object3D) { return new MeshRenderable('fixture', meta, root); }
describe('bounded scene geometry', () => {
  it('samples triangle surfaces and honors nested transformed mesh coordinates', async () => {
    const root = new THREE.Group(), mesh = floor();
    root.add(mesh);
    root.position.set(4e6, 7, 3e6);
    root.scale.set(2, 1, 3);
    const data = await prepareSceneGeometry([renderable(root)], signal());
    expect(data.positions.length / 3).toBeLessThanOrEqual(MAX_GROUND_SAMPLES);
    expect(data.triangles).toHaveLength(2);
    expect(data.provenance).toBe('mesh-surface');
    expect(data.positions[1]).toBeCloseTo(0);
    expect(data.anchor.toArray()).toEqual([4e6, 7, 3e6]);
    const scale = playerScale(1.7);
    if (!scale)
      throw new Error('Fixture scale');
    const collider = collisionInFrame(data, gameFrame(new THREE.Vector3(4e6, 7, 3e6), new THREE.Vector3(0, 1, 0)));
    expect(collider?.support(0, 0, .1, .2).kind).toBe('hit');
    expect(collider?.contacts(new THREE.Vector3(0, .01, 0), scale).kind).toBe('ok');
  });
  it('samples interior triangle area rather than only corner vertices', async () => {
    const data = await prepareSceneGeometry([renderable(floor())], signal());
    let inside = 0;
    for (let i = 0; i < data.positions.length; i += 3)
      if (Math.abs(data.positions[i] ?? 10) < 2 && Math.abs(data.positions[i + 2] ?? 10) < 2)
        inside++;
    expect(inside).toBeGreaterThan(100);
  });
  it('maintains a global cap across many objects and rejects collision on source overflow', async () => {
    const root = new THREE.Group();
    for (let i = 0; i < 260; i++)
      root.add(floor());
    const data = await prepareSceneGeometry([renderable(root)], signal());
    expect(data.positions.length / 3).toBeLessThanOrEqual(MAX_GROUND_SAMPLES);
    expect(data.triangles).toBeNull();
    expect(data.collisionReason).toContain('Too many');
  });
  it('keeps complete transformed collision triangles, including mirrored geometry', async () => {
    const mesh = floor();
    mesh.scale.x = -1;
    mesh.rotation.z = .2;
    const data = await prepareSceneGeometry([renderable(mesh)], signal());
    expect(data.triangles).toHaveLength(2);
    const normal = new THREE.Vector3(0, 1, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), .2);
    const collider = collisionInFrame(data, gameFrame(new THREE.Vector3(), normal));
    expect(collider?.support(0, 0, .1, .2).kind).toBe('hit');
  });
  it('rejects animated/transparent/instanced collision instead of silently omitting surfaces', async () => {
    const mesh = floor();
    mesh.material.transparent = true;
    const data = await prepareSceneGeometry([renderable(mesh)], signal());
    expect(data.triangles).toBeNull();
    expect(data.positions.length).toBeGreaterThan(0);
  });
  it('honors draw ranges in collision and samples', async () => {
    const mesh = floor();
    mesh.geometry.setDrawRange(0, 3);
    const data = await prepareSceneGeometry([renderable(mesh)], signal());
    expect(data.triangles).toHaveLength(1);
  });
  it('cancels before returning any scene geometry', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(prepareSceneGeometry([renderable(floor())], abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('uses retained point positions with world origin, not rendered point radius', async () => {
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 1, NaN, 0, 0], 3));
    const object = new THREE.Points(geometry, new THREE.PointsMaterial());
    object.position.set(100, 20, 200);
    const item: Renderable = { id: 'p', name: 'p', kind: 'points', object, meta, update() { }, applySettings() { }, getStats: () => ({ kind: 'points', label: 'p', primitives: 3 }), getBounds: () => new THREE.Box3(new THREE.Vector3(100, 20, 200), new THREE.Vector3(101, 20, 201)), dispose() { } };
    const data = await prepareSceneGeometry([item], signal());
    expect(data.triangles).toBeNull();
    expect(data.positions.length).toBe(6);
    expect([...data.positions]).toEqual([-.5, 0, -.5, .5, 0, .5]);
  });
});
describe('Gaussian original-center floor evidence adapter', () => {
  it('decodes packed finite centers with opacity filtering and transforms', () => {
    const object = Object.assign(new THREE.Object3D(), { paged: false, packedSplats: { numSplats: 3, packedArray: new Uint32Array([
          255 << 24, toHalf(2) | (toHalf(3) << 16), toHalf(4), 0,
          10 << 24, toHalf(9), 0, 0,
          255 << 24, toHalf(Infinity), 0, 0,
        ]) } });
    object.position.x = 100;
    const values = Reflect.apply(GaussianRenderable.prototype.navigationSamples, { object }, [10, new THREE.Vector3(100, 0, 0)]);
    expect(values).toEqual(new Float32Array([2, 3, 4]));
  });
  it('decodes extended float centers without half-float coordinate loss', () => {
    const floats = new Float32Array([1.234567, 2.345678, 3.456789, 0]);
    const bits = new Uint32Array(floats.buffer);
    bits[3] = toHalf(.8);
    const object = Object.assign(new THREE.Object3D(), { paged: false, extSplats: { numSplats: 1, extArrays: [bits, new Uint32Array(4)] } });
    const values = Reflect.apply(GaussianRenderable.prototype.navigationSamples, { object }, [10, new THREE.Vector3()]);
    expect(values).toEqual(new Float32Array([floats[0] ?? 0, floats[1] ?? 0, floats[2] ?? 0]));
  });
  it('does not infer whole-scene surfaces from paged buffers', () => {
    expect(Reflect.apply(GaussianRenderable.prototype.navigationSamples, { object: { paged: true } }, [100, new THREE.Vector3()])).toBeNull();
  });
});
