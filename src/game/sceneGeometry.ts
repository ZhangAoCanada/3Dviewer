import * as THREE from 'three';
import type { Renderable } from '../core/types';
import { GaussianRenderable } from '../renderables/gaussianRenderable';
import { MAX_COLLISION_TRIANGLES, MeshCollision } from './meshCollision';
import { toLocal, type GameFrame, type Footprint } from './frame';
export const MAX_GROUND_SAMPLES = 24000;
const MAX_SOURCES = 256;
export interface SceneGeometry {
  anchor: THREE.Vector3;
  bounds: THREE.Box3;
  positions: Float32Array;
  provenance: 'mesh-surface' | 'points' | 'gaussian-centers';
  triangles: THREE.Triangle[] | null;
  collisionReason: string;
}
export type GeometrySource = {
  kind: 'mesh';
  mesh: THREE.Mesh;
} | {
  kind: 'points';
  points: THREE.Points;
} | {
  kind: 'splats';
  renderable: GaussianRenderable;
};
const yieldTask = () => new Promise<void>(resolve => globalThis.setTimeout(resolve, 0));
export async function prepareSceneGeometry(items: readonly Renderable[], signal: AbortSignal): Promise<SceneGeometry> {
  const bounds = new THREE.Box3();
  const sources: GeometrySource[] = [];
  let collisionReason = '';
  let sourcesOverflow = false;
  const addSource = (source: GeometrySource) => { if (sources.length < MAX_SOURCES)
    sources.push(source);
  else
    sourcesOverflow = true; };
  for (const item of items) {
    const b = item.getBounds();
    if (b)
      bounds.union(b);
    item.object.updateWorldMatrix(true, true);
    if (item instanceof GaussianRenderable) {
      addSource({ kind: 'splats', renderable: item });
      collisionReason = 'Gaussian ellipsoids are appearance, not solid geometry.';
    }
    else
      item.object.traverseVisible(object => {
        if (object instanceof THREE.Points) {
          addSource({ kind: 'points', points: object });
          collisionReason = 'Point clouds have no connected collision surfaces.';
        }
        else if (object instanceof THREE.Mesh)
          addSource({ kind: 'mesh', mesh: object });
      });
  }
  signal.throwIfAborted();
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite))
    throw new Error('This scene has no finite bounds.');
  const anchor = bounds.getCenter(new THREE.Vector3());
  const values: number[] = [];
  let triangles: THREE.Triangle[] | null = collisionReason ? null : [];
  const selected = sources.slice(0, MAX_SOURCES);
  if (sourcesOverflow) {
    triangles = null;
    collisionReason = 'Too many objects for bounded static collision.';
  }
  const perSource = Math.max(1, Math.floor(MAX_GROUND_SAMPLES / Math.max(1, selected.length)));
  for (const source of selected) {
    signal.throwIfAborted();
    if (source.kind === 'splats') {
      const sampled = source.renderable.navigationSamples(perSource, anchor);
      if (sampled)
        for (const value of sampled)
          values.push(value);
    }
    else if (source.kind === 'points') {
      const object = source.points, attr = object.geometry.getAttribute('position');
      if (!attr)
        continue;
      const stride = Math.max(1, Math.ceil(attr.count / perSource));
      for (let i = 0; i < attr.count; i += stride) {
        const v = new THREE.Vector3().fromBufferAttribute(attr, i).applyMatrix4(object.matrixWorld).sub(anchor);
        if (v.toArray().every(Number.isFinite))
          values.push(v.x, v.y, v.z);
      }
    }
    else {
      const mesh = source.mesh, geometry = mesh.geometry;
      const attr = geometry.getAttribute('position'), index = geometry.getIndex();
      if (!attr)
        continue;
      const start = geometry.drawRange.start;
      const total = index?.count ?? attr.count;
      const end = Math.min(total, start + geometry.drawRange.count);
      const count = Math.floor((end - start) / 3);
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh || Object.keys(geometry.morphAttributes).length ||
        materials.some(m => !m.visible || m.transparent || m.opacity < 1 || m.alphaTest > 0) || start % 3 !== 0 || (end - start) % 3 !== 0) {
        triangles = null;
        collisionReason = 'Animated, instanced or transparent surfaces need explicit virtual-floor mode.';
      }
      if (triangles && triangles.length + count > MAX_COLLISION_TRIANGLES) {
        triangles = null;
        collisionReason = `Static collision is limited to ${MAX_COLLISION_TRIANGLES.toLocaleString()} triangles; this scene is larger.`;
      }
      const readTriangle = (face: number) => {
        const corner = (n: number) => {
          const offset = start + face * 3 + n;
          return new THREE.Vector3().fromBufferAttribute(attr, index ? index.getX(offset) : offset).applyMatrix4(mesh.matrixWorld).sub(anchor);
        };
        return new THREE.Triangle(corner(0), corner(1), corner(2));
      };
      const faces: THREE.Triangle[] = [], cumulative: number[] = [];
      let area = 0;
      const candidates = Math.min(count, perSource);
      for (let i = 0; i < candidates; i++) {
        const t = readTriangle(Math.floor(i * count / candidates));
        const a = t.getArea();
        if (a > 0 && Number.isFinite(a) && [...t.a.toArray(), ...t.b.toArray(), ...t.c.toArray()].every(Number.isFinite)) {
          area += a;
          faces.push(t);
          cumulative.push(area);
        }
        if (i % 1024 === 1023) {
          await yieldTask();
          signal.throwIfAborted();
        }
      }
      let seed = 1234567;
      const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
      for (let i = 0; i < perSource && area > 0; i++) {
        const target = random() * area;
        let low = 0, high = cumulative.length - 1;
        while (low < high) {
          const mid = (low + high) >>> 1;
          if ((cumulative[mid] ?? 0) < target)
            low = mid + 1;
          else
            high = mid;
        }
        const t = faces[low];
        if (!t)
          continue;
        const a = Math.sqrt(random()), b = random();
        const v = t.a.clone().multiplyScalar(1 - a).addScaledVector(t.b, a * (1 - b)).addScaledVector(t.c, a * b);
        values.push(v.x, v.y, v.z);
      }
      if (triangles)
        for (let face = 0; face < count; face++) {
          const t = readTriangle(face);
          if (![...t.a.toArray(), ...t.b.toArray(), ...t.c.toArray()].every(Number.isFinite)) {
            triangles = null;
            collisionReason = 'Invalid static geometry.';
            break;
          }
          if (t.getArea() > 0)
            triangles.push(t);
          if (face % 1024 === 1023) {
            await yieldTask();
            signal.throwIfAborted();
          }
        }
    }
    await yieldTask();
  }
  signal.throwIfAborted();
  const provenance = selected.every(s => s.kind === 'mesh') ? 'mesh-surface' : selected.some(s => s.kind === 'splats') ? 'gaussian-centers' : 'points';
  return { anchor, bounds, positions: Float32Array.from(values), provenance, triangles: triangles?.length ? triangles : null,
    collisionReason: collisionReason || (triangles?.length ? '' : 'No static collision surfaces available.') };
}
export function collisionInFrame(geometry: SceneGeometry, frame: GameFrame): MeshCollision | null {
  if (!geometry.triangles)
    return null;
  return new MeshCollision(geometry.triangles.map(t => new THREE.Triangle(toLocal(frame, t.a.clone().add(geometry.anchor)), toLocal(frame, t.b.clone().add(geometry.anchor)), toLocal(frame, t.c.clone().add(geometry.anchor)))));
}
/** A previewed artificial rectangular floor, not inferred occupancy. */
export function footprintInFrame(bounds: THREE.Box3, frame: GameFrame): Footprint {
  const box = new THREE.Box3();
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        box.expandByPoint(toLocal(frame, new THREE.Vector3(x, y, z)));
      }
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
}
