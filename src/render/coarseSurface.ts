import * as THREE from 'three';

const MAX_CELLS = 36;

export function sampleStride(count: number, maxPoints: number): number {
  if (count <= 0 || maxPoints <= 0) return 1;
  return Math.max(1, Math.ceil(count / maxPoints));
}

export function halfToFloat(half: number): number {
  const h = half & 65535;
  const sign = (h & 0x8000) >> 15;
  const exp = (h & 0x7c00) >> 10;
  const frac = h & 0x03ff;
  if (exp === 0) {
    if (frac === 0) return sign ? -0 : 0;
    return (sign ? -1 : 1) * 2 ** -14 * (frac / 1024);
  }
  if (exp === 31) return frac ? Number.NaN : sign ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  return (sign ? -1 : 1) * 2 ** (exp - 15) * (1 + frac / 1024);
}

export function uintBitsToFloat(bits: number): number {
  const u32 = new Uint32Array(1);
  const f32 = new Float32Array(u32.buffer);
  u32[0] = bits >>> 0;
  return f32[0] ?? 0;
}

interface RaySpan {
  tNear: number;
  tFar: number;
}

/** Slab test. `tNear` can be negative when the origin is inside the box. */
export function rayAabb(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  min: THREE.Vector3,
  max: THREE.Vector3,
): RaySpan | null {
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

/**
 * A few tens of thousands of sample positions, bucketed so a pick does not
 * walk every splat in the file.
 */
export class CoarseSurface {
  private readonly points: Float32Array;
  private readonly buckets: Map<number, number[]>;
  private readonly seen: Uint32Array;
  private stamp = 1;
  private readonly minX: number;
  private readonly minY: number;
  private readonly minZ: number;
  private readonly cell: number;
  private readonly dx: number;
  private readonly dy: number;
  private readonly dz: number;
  private readonly boxMin = new THREE.Vector3();
  private readonly boxMax = new THREE.Vector3();

  constructor(points: Float32Array) {
    this.points = points;
    const count = Math.floor(points.length / 3);
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < count; i += 1) {
      const x = points[i * 3] ?? 0;
      const y = points[i * 3 + 1] ?? 0;
      const z = points[i * 3 + 2] ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      minZ = 0;
      maxX = 1;
      maxY = 1;
      maxZ = 1;
    }
    const sizeX = Math.max(maxX - minX, 1e-4);
    const sizeY = Math.max(maxY - minY, 1e-4);
    const sizeZ = Math.max(maxZ - minZ, 1e-4);
    const longest = Math.max(sizeX, sizeY, sizeZ);
    this.cell = longest / MAX_CELLS;
    this.dx = Math.max(1, Math.min(MAX_CELLS, Math.ceil(sizeX / this.cell)));
    this.dy = Math.max(1, Math.min(MAX_CELLS, Math.ceil(sizeY / this.cell)));
    this.dz = Math.max(1, Math.min(MAX_CELLS, Math.ceil(sizeZ / this.cell)));
    this.minX = minX;
    this.minY = minY;
    this.minZ = minZ;
    this.boxMin.set(minX, minY, minZ);
    this.boxMax.set(minX + this.dx * this.cell, minY + this.dy * this.cell, minZ + this.dz * this.cell);
    this.buckets = new Map();
    for (let i = 0; i < count; i += 1) {
      const key = this.keyFor(points[i * 3] ?? 0, points[i * 3 + 1] ?? 0, points[i * 3 + 2] ?? 0);
      const list = this.buckets.get(key);
      if (list) list.push(i);
      else this.buckets.set(key, [i]);
    }
    this.seen = new Uint32Array(this.dx * this.dy * this.dz);
  }

  get pointCount(): number {
    return Math.floor(this.points.length / 3);
  }

  /** Closest sample the ray passes near, or null when it misses the cloud. */
  pick(origin: THREE.Vector3, direction: THREE.Vector3): THREE.Vector3 | null {
    const dir = direction.clone();
    if (dir.lengthSq() < 1e-16) return null;
    dir.normalize();
    const span = rayAabb(origin, dir, this.boxMin, this.boxMax);
    if (!span) return null;
    this.stamp += 1;
    if (this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const radius = this.cell * 1.05;
    const radiusSq = radius * radius;
    let bestT = Infinity;
    let bestX = 0;
    let bestY = 0;
    let bestZ = 0;
    let found = false;

    const consider = (ix: number, iy: number, iz: number) => {
      if (ix < 0 || iy < 0 || iz < 0 || ix >= this.dx || iy >= this.dy || iz >= this.dz) return;
      const key = ix + this.dx * (iy + this.dy * iz);
      if (this.seen[key] === this.stamp) return;
      this.seen[key] = this.stamp;
      const list = this.buckets.get(key);
      if (!list) return;
      for (const index of list) {
        const x = this.points[index * 3] ?? 0;
        const y = this.points[index * 3 + 1] ?? 0;
        const z = this.points[index * 3 + 2] ?? 0;
        const ox = x - origin.x;
        const oy = y - origin.y;
        const oz = z - origin.z;
        const t = ox * dir.x + oy * dir.y + oz * dir.z;
        if (t < 1e-3 || t >= bestT) continue;
        const dx = ox - dir.x * t;
        const dy = oy - dir.y * t;
        const dz = oz - dir.z * t;
        if (dx * dx + dy * dy + dz * dz > radiusSq) continue;
        bestT = t;
        bestX = x;
        bestY = y;
        bestZ = z;
        found = true;
      }
    };

    let t = Math.max(span.tNear, 0);
    const startX = origin.x + dir.x * (t + this.cell * 1e-4);
    const startY = origin.y + dir.y * (t + this.cell * 1e-4);
    const startZ = origin.z + dir.z * (t + this.cell * 1e-4);
    let ix = clampIndex((startX - this.minX) / this.cell, this.dx);
    let iy = clampIndex((startY - this.minY) / this.cell, this.dy);
    let iz = clampIndex((startZ - this.minZ) / this.cell, this.dz);
    const stepX = dir.x >= 0 ? 1 : -1;
    const stepY = dir.y >= 0 ? 1 : -1;
    const stepZ = dir.z >= 0 ? 1 : -1;
    const tDeltaX = Math.abs(dir.x) < 1e-12 ? Infinity : Math.abs(this.cell / dir.x);
    const tDeltaY = Math.abs(dir.y) < 1e-12 ? Infinity : Math.abs(this.cell / dir.y);
    const tDeltaZ = Math.abs(dir.z) < 1e-12 ? Infinity : Math.abs(this.cell / dir.z);
    const nextX = this.minX + (ix + (stepX > 0 ? 1 : 0)) * this.cell;
    const nextY = this.minY + (iy + (stepY > 0 ? 1 : 0)) * this.cell;
    const nextZ = this.minZ + (iz + (stepZ > 0 ? 1 : 0)) * this.cell;
    let tMaxX = Math.abs(dir.x) < 1e-12 ? Infinity : (nextX - origin.x) / dir.x;
    let tMaxY = Math.abs(dir.y) < 1e-12 ? Infinity : (nextY - origin.y) / dir.y;
    let tMaxZ = Math.abs(dir.z) < 1e-12 ? Infinity : (nextZ - origin.z) / dir.z;
    const maxSteps = this.dx + this.dy + this.dz + 4;
    for (let step = 0; step < maxSteps; step += 1) {
      for (let oz = -1; oz <= 1; oz += 1) {
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) consider(ix + ox, iy + oy, iz + oz);
        }
      }
      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        ix += stepX;
        if (ix < 0 || ix >= this.dx) break;
        t = tMaxX;
        tMaxX += tDeltaX;
      } else if (tMaxY <= tMaxZ) {
        iy += stepY;
        if (iy < 0 || iy >= this.dy) break;
        t = tMaxY;
        tMaxY += tDeltaY;
      } else {
        iz += stepZ;
        if (iz < 0 || iz >= this.dz) break;
        t = tMaxZ;
        tMaxZ += tDeltaZ;
      }
      if (t > span.tFar + this.cell) break;
    }
    return found ? new THREE.Vector3(bestX, bestY, bestZ) : null;
  }

  private keyFor(x: number, y: number, z: number): number {
    const ix = clampIndex((x - this.minX) / this.cell, this.dx);
    const iy = clampIndex((y - this.minY) / this.cell, this.dy);
    const iz = clampIndex((z - this.minZ) / this.cell, this.dz);
    return ix + this.dx * (iy + this.dy * iz);
  }
}

function clampIndex(value: number, size: number): number {
  return Math.max(0, Math.min(size - 1, Math.floor(value)));
}
