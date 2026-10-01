import * as THREE from 'three';
import { CoarseSurface, halfToFloat, sampleStride, uintBitsToFloat } from './coarseSurface';

const MAX_SAMPLES = 24_000;

type SplatLike = THREE.Object3D & {
  numSplats?: number;
  packedSplats?: { packedArray?: Uint32Array };
  extSplats?: { extArrays?: [Uint32Array, Uint32Array] };
  raycastable?: boolean;
};

export function isSplatObject(object: THREE.Object3D): object is SplatLike {
  return 'packedSplats' in object || 'extSplats' in object;
}

/** Spark's raycast walks every splat. Navigation must not call it. */
export function disableSplatRaycast(object: THREE.Object3D): void {
  if (isSplatObject(object)) object.raycastable = false;
}

/**
 * Subsample splat and point positions. The stride jumps through the buffer,
 * so a 14M cloud contributes about `maxPoints` samples, not 14M tests.
 */
export function collectCoarsePoints(root: THREE.Object3D, maxPoints = MAX_SAMPLES): Float32Array | null {
  const samples: number[] = [];
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    if (isSplatObject(object)) appendSplats(object, samples, maxPoints);
    else if ((object as THREE.Points).isPoints) appendAttribute(object as THREE.Points, samples, maxPoints);
  });
  if (samples.length < 3) return null;
  return Float32Array.from(samples);
}

export function buildCoarse(points: Float32Array | null): CoarseSurface | null {
  if (!points || points.length < 3) return null;
  return new CoarseSurface(points);
}

export interface SceneHit {
  point: THREE.Vector3;
  surface: boolean;
}

export function pickScene(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  coarse: CoarseSurface | null,
  meshes: THREE.Object3D[],
  raycaster: THREE.Raycaster,
  bounds: THREE.Box3 | null,
  pivot: THREE.Vector3,
  indexPoint: THREE.Vector3 | null = null,
): SceneHit | null {
  let best: SceneHit | null = null;
  let bestDist = Infinity;
  const consider = (point: THREE.Vector3, surface: boolean) => {
    const dist = origin.distanceTo(point);
    if (dist >= bestDist) return;
    bestDist = dist;
    best = { point: point.clone(), surface };
  };

  if (meshes.length > 0) {
    raycaster.set(origin, direction.clone().normalize());
    const hits = raycaster.intersectObjects(meshes, false);
    const hit = hits[0];
    if (hit) consider(hit.point, true);
  }
  if (indexPoint) consider(indexPoint, true);
  else if (coarse) {
    const point = coarse.pick(origin, direction);
    if (point) consider(point, true);
  }
  if (best) return best;
  if (bounds && !bounds.isEmpty()) {
    const dir = direction.clone().normalize();
    const span = rayBox(origin, dir, bounds);
    if (span) {
      const t = span.tNear > 0 ? span.tNear : Math.max(span.tFar * 0.5, 0);
      return { point: origin.clone().addScaledVector(dir, t), surface: false };
    }
  }
  const dir = direction.clone().normalize();
  const view = pivot.clone().sub(origin);
  const viewLen = view.length();
  if (viewLen < 1e-6) return null;
  view.multiplyScalar(1 / viewLen);
  const denom = view.dot(dir);
  if (Math.abs(denom) < 1e-5) return { point: pivot.clone(), surface: false };
  const t = view.dot(pivot.clone().sub(origin)) / denom;
  if (t < 0.05) return { point: pivot.clone(), surface: false };
  return { point: origin.clone().addScaledVector(dir, t), surface: false };
}

function appendSplats(mesh: SplatLike, samples: number[], maxPoints: number): void {
  const packedCount = mesh.packedSplats?.packedArray ? mesh.packedSplats.packedArray.length / 4 : 0;
  const extCount = mesh.extSplats?.extArrays?.[0] ? mesh.extSplats.extArrays[0].length / 4 : 0;
  const count = mesh.numSplats || packedCount || extCount;
  if (count <= 0) return;
  const stride = sampleStride(count, maxPoints);
  const ext = mesh.extSplats?.extArrays?.[0];
  const packed = mesh.packedSplats?.packedArray;
  const world = mesh.matrixWorld;
  const v = new THREE.Vector3();
  if (ext) {
    for (let i = 0; i < count; i += stride) {
      const o = i * 4;
      v.set(uintBitsToFloat(ext[o] ?? 0), uintBitsToFloat(ext[o + 1] ?? 0), uintBitsToFloat(ext[o + 2] ?? 0));
      v.applyMatrix4(world);
      samples.push(v.x, v.y, v.z);
    }
    return;
  }
  if (!packed) return;
  for (let i = 0; i < count; i += stride) {
    const o = i * 4;
    const xy = packed[o + 1] ?? 0;
    const zw = packed[o + 2] ?? 0;
    v.set(halfToFloat(xy & 65535), halfToFloat(xy >>> 16), halfToFloat(zw & 65535));
    v.applyMatrix4(world);
    samples.push(v.x, v.y, v.z);
  }
}

function appendAttribute(object: THREE.Points, samples: number[], maxPoints: number): void {
  const attr = object.geometry.getAttribute('position');
  if (!attr) return;
  const stride = sampleStride(attr.count, maxPoints);
  const v = new THREE.Vector3();
  for (let i = 0; i < attr.count; i += stride) {
    v.fromBufferAttribute(attr, i).applyMatrix4(object.matrixWorld);
    samples.push(v.x, v.y, v.z);
  }
}

function rayBox(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  box: THREE.Box3,
): { tNear: number; tFar: number } | null {
  const min = box.min;
  const max = box.max;
  let tNear = -Infinity;
  let tFar = Infinity;
  const o = [origin.x, origin.y, origin.z];
  const d = [direction.x, direction.y, direction.z];
  const b0 = [min.x, min.y, min.z];
  const b1 = [max.x, max.y, max.z];
  for (let axis = 0; axis < 3; axis += 1) {
    const originAxis = o[axis] ?? 0;
    const dir = d[axis] ?? 0;
    const minAxis = b0[axis] ?? 0;
    const maxAxis = b1[axis] ?? 0;
    if (Math.abs(dir) < 1e-12) {
      if (originAxis < minAxis || originAxis > maxAxis) return null;
      continue;
    }
    let t0 = (minAxis - originAxis) / dir;
    let t1 = (maxAxis - originAxis) / dir;
    if (t0 > t1) {
      const swap = t0;
      t0 = t1;
      t1 = swap;
    }
    tNear = Math.max(tNear, t0);
    tFar = Math.min(tFar, t1);
    if (tNear > tFar) return null;
  }
  if (tFar < 0) return null;
  return { tNear, tFar };
}
