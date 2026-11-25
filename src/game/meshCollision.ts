import * as THREE from 'three';
import type { PlayerScale } from './frame';
import { runCooperatively } from './cooperative';
const DEFERRED = Symbol('deferred collision construction');
export const MAX_COLLISION_TRIANGLES = 20000;
const QUERY_LIMIT = 4096;
const SLOPE_COS = Math.cos(Math.PI / 4);
interface Node {
  box: THREE.Box3;
  indices: number[];
  children: Node[];
}
export interface Contact {
  normal: THREE.Vector3;
  depth: number;
}
export type CollisionQuery = {
  kind: 'ok';
  contacts: Contact[];
} | {
  kind: 'budget';
};
export type Support = {
  kind: 'hit';
  y: number;
  normal: THREE.Vector3;
} | {
  kind: 'miss';
} | {
  kind: 'budget';
};
/** Static bounded triangle BVH. Never truncate triangles and pretend the missing walls are empty. */
export class MeshCollision {
  private root!: Node;
  private remainingTests = 8192;

  beginFrame(): void { this.remainingTests = 8192; }
  readonly bounds = new THREE.Box3();
  constructor(private readonly triangles: readonly THREE.Triangle[], deferred?: typeof DEFERRED) {
    if (triangles.length === 0 || triangles.length > MAX_COLLISION_TRIANGLES)
      throw new Error('Collision triangle budget exceeded.');
    if (deferred !== DEFERRED) {
      // Synchronous construction remains useful for small pure fixtures. Production uses create().
      for (const unit of this.prepare()) void unit;
    }
  }
  static async create(triangles: readonly THREE.Triangle[], signal: AbortSignal): Promise<MeshCollision> {
    signal.throwIfAborted();
    const collision = new MeshCollision(triangles, DEFERRED);
    await runCooperatively(collision.prepare(), signal);
    return collision;
  }
  private *prepare(): Generator<void, void, unknown> {
    const indices: number[] = [];
    for (let i = 0; i < this.triangles.length; i++) {
      const t = this.triangles[i]!;
      for (const v of [t.a, t.b, t.c]) {
        if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z))
          throw new Error('Invalid collision geometry.');
        this.bounds.expandByPoint(v);
      }
      indices.push(i);
      yield;
    }
    this.root = yield* this.build(indices, 0);
  }
  private *build(indices: number[], depth: number): Generator<void, Node, unknown> {
    const box = new THREE.Box3();
    for (const i of indices) {
      const t = this.triangles[i]!;
      box.expandByPoint(t.a).expandByPoint(t.b).expandByPoint(t.c);
      yield;
    }
    if (indices.length <= 12 || depth >= 18)
      return { box, indices, children: [] };
    const size = box.getSize(new THREE.Vector3());
    const axis = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    const middle = box.min[axis] / 2 + box.max[axis] / 2;
    let left: number[] = [], right: number[] = [];
    for (const i of indices) {
      const t = this.triangles[i]!;
      const center = t.a[axis] / 3 + t.b[axis] / 3 + t.c[axis] / 3;
      (center < middle ? left : right).push(i);
      yield;
    }
    // Coincident/long triangles may have indistinguishable centroids. Preserve complete
    // coverage with an ordered half split rather than an uninterruptible Array.sort.
    if (!left.length || !right.length) {
      left = []; right = [];
      const half = Math.floor(indices.length / 2);
      for (let i = 0; i < indices.length; i++) {
        (i < half ? left : right).push(indices[i]!);
        yield;
      }
    }
    const first = yield* this.build(left, depth + 1);
    const second = yield* this.build(right, depth + 1);
    return { box, indices: [], children: [first, second] };
  }
  private query(box: THREE.Box3): number[] | null {
    const indices: number[] = [];
    const stack = [this.root];
    let visits = 0;
    while (stack.length) {
      const node = stack.pop();
      if (!node || !node.box.intersectsBox(box))
        continue;
      if (++visits > QUERY_LIMIT)
        return null;
      if (indices.length + node.indices.length > QUERY_LIMIT)
        return null;
      indices.push(...node.indices);
      stack.push(...node.children);
    }
    if (indices.length > this.remainingTests) return null;
    this.remainingTests -= indices.length;
    return indices;
  }
  contacts(foot: THREE.Vector3, scale: PlayerScale): CollisionQuery {
    const a = foot.clone().add(new THREE.Vector3(0, scale.radius, 0));
    const b = foot.clone().add(new THREE.Vector3(0, scale.height - scale.radius, 0));
    const box = new THREE.Box3().setFromPoints([a, b]).expandByScalar(scale.radius);
    const indices = this.query(box);
    if (!indices)
      return { kind: 'budget' };
    const contacts: Contact[] = [];
    for (const i of indices) {
      const triangle = this.triangles[i];
      if (!triangle)
        continue;
      const pair = segmentTriangle(a, b, triangle);
      const distance = pair.axis.distanceTo(pair.surface);
      const depth = scale.radius - distance;
      if (depth <= scale.skin)
        continue;
      let normal = pair.axis.clone().sub(pair.surface);
      if (normal.lengthSq() < 1e-20) {
        normal = triangle.getNormal(new THREE.Vector3());
        if (normal.dot(a.clone().add(b).multiplyScalar(0.5).sub(triangle.a)) < 0)
          normal.negate();
      }
      contacts.push({ normal: normal.normalize(), depth });
    }
    return { kind: 'ok', contacts };
  }
  support(x: number, z: number, fromY: number, down: number): Support {
    const box = new THREE.Box3(new THREE.Vector3(x - 1e-8, fromY - down, z - 1e-8), new THREE.Vector3(x + 1e-8, fromY, z + 1e-8));
    const indices = this.query(box);
    if (!indices)
      return { kind: 'budget' };
    const ray = new THREE.Ray(new THREE.Vector3(x, fromY, z), new THREE.Vector3(0, -1, 0));
    let best: {
      y: number;
      normal: THREE.Vector3;
    } | null = null;
    for (const i of indices) {
      const t = this.triangles[i];
      if (!t)
        continue;
      const hit = ray.intersectTriangle(t.a, t.b, t.c, false, new THREE.Vector3());
      if (!hit || fromY - hit.y > down || (best && hit.y <= best.y))
        continue;
      const normal = t.getNormal(new THREE.Vector3());
      if (normal.y < 0)
        normal.negate();
      if (normal.y < SLOPE_COS)
        continue;
      best = { y: hit.y, normal };
    }
    return best ? { kind: 'hit', ...best } : { kind: 'miss' };
  }
}
/** Closest points of two finite segments (including degenerate edges). */
function segments(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
  const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
  const aa = u.dot(u), bb = u.dot(v), cc = v.dot(v), dd = u.dot(w), ee = v.dot(w);
  let s = 0, t = 0;
  if (aa <= 1e-24)
    t = cc > 0 ? THREE.MathUtils.clamp(ee / cc, 0, 1) : 0;
  else {
    const det = aa * cc - bb * bb;
    s = det > 1e-24 ? THREE.MathUtils.clamp((bb * ee - cc * dd) / det, 0, 1) : 0;
    t = cc > 1e-24 ? (bb * s + ee) / cc : 0;
    if (t < 0) {
      t = 0;
      s = THREE.MathUtils.clamp(-dd / aa, 0, 1);
    }
    else if (t > 1) {
      t = 1;
      s = THREE.MathUtils.clamp((bb - dd) / aa, 0, 1);
    }
  }
  return { axis: a.clone().addScaledVector(u, s), surface: c.clone().addScaledVector(v, t) };
}
function segmentTriangle(a: THREE.Vector3, b: THREE.Vector3, triangle: THREE.Triangle) {
  const direction = b.clone().sub(a);
  const length = direction.length();
  if (length > 0) {
    const hit = new THREE.Ray(a, direction.multiplyScalar(1 / length))
      .intersectTriangle(triangle.a, triangle.b, triangle.c, false, new THREE.Vector3());
    if (hit && hit.distanceTo(a) <= length)
      return { axis: hit, surface: hit.clone() };
  }
  let best = { axis: a.clone(), surface: triangle.closestPointToPoint(a, new THREE.Vector3()) };
  const consider = (pair: typeof best) => { if (pair.axis.distanceToSquared(pair.surface) < best.axis.distanceToSquared(best.surface))
    best = pair; };
  consider({ axis: b.clone(), surface: triangle.closestPointToPoint(b, new THREE.Vector3()) });
  consider(segments(a, b, triangle.a, triangle.b));
  consider(segments(a, b, triangle.b, triangle.c));
  consider(segments(a, b, triangle.c, triangle.a));
  return best;
}
