import * as THREE from 'three';
import type { AssetSource } from '../core/types';

/** 180° about X. This is the OpenCV / COLMAP flip, applied on the content group. */
export const FLIP_Y = new THREE.Quaternion(1, 0, 0, 0);

const UPRIGHT_KEY = '3dviewer-upright';
const UPRIGHT_CAP = 32;
/** Repeated 90° turns land on one of the 24 axis-aligned rotations. */
const SNAP_RADIANS = (0.01 * Math.PI) / 180;

export interface UprightEntry {
  q: [number, number, number, number];
  up: 'y' | 'z';
  at: number;
}

export type UprightMap = Record<string, UprightEntry>;

export interface UprightStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const AXIS_ROTATIONS = axisAlignedRotations();

/** Smallest eigenvector of the covariance. Null when the patch is too small or collinear. */
export function fitPlane(points: Float32Array): { normal: THREE.Vector3; rms: number; count: number } | null {
  const count = Math.floor(points.length / 3);
  if (count < 8) return null;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i += 1) {
    cx += points[i * 3] ?? 0;
    cy += points[i * 3 + 1] ?? 0;
    cz += points[i * 3 + 2] ?? 0;
  }
  cx /= count;
  cy /= count;
  cz /= count;
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (let i = 0; i < count; i += 1) {
    const x = (points[i * 3] ?? 0) - cx;
    const y = (points[i * 3 + 1] ?? 0) - cy;
    const z = (points[i * 3 + 2] ?? 0) - cz;
    xx += x * x;
    xy += x * y;
    xz += x * z;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  }
  xx /= count;
  xy /= count;
  xz /= count;
  yy /= count;
  yz /= count;
  zz /= count;
  const eigen = jacobi3([
    [xx, xy, xz],
    [xy, yy, yz],
    [xz, yz, zz],
  ]);
  let smallest = 0;
  if ((eigen.values[1] ?? 0) < (eigen.values[smallest] ?? 0)) smallest = 1;
  if ((eigen.values[2] ?? 0) < (eigen.values[smallest] ?? 0)) smallest = 2;
  const largest = Math.max(eigen.values[0] ?? 0, eigen.values[1] ?? 0, eigen.values[2] ?? 0);
  if (!(largest > 0)) return null;
  const ordered = [eigen.values[0] ?? 0, eigen.values[1] ?? 0, eigen.values[2] ?? 0].sort((a, b) => a - b);
  const low = ordered[0] ?? 0;
  const mid = ordered[1] ?? 0;
  if (low < 1e-9 * largest && mid < 1e-9 * largest) return null;
  const column = eigen.vectors[smallest] ?? [0, 0, 1];
  const normal = new THREE.Vector3(column[0] ?? 0, column[1] ?? 0, column[2] ?? 1);
  if (normal.lengthSq() < 1e-20) return null;
  normal.normalize();
  let square = 0;
  for (let i = 0; i < count; i += 1) {
    const x = (points[i * 3] ?? 0) - cx;
    const y = (points[i * 3 + 1] ?? 0) - cy;
    const z = (points[i * 3 + 2] ?? 0) - cz;
    const distance = normal.x * x + normal.y * y + normal.z * z;
    square += distance * distance;
  }
  return { normal, rms: Math.sqrt(square / count), count };
}

/** Distance from the patch centroid to the farthest sample. */
export function patchRadius(points: Float32Array): number {
  const count = Math.floor(points.length / 3);
  if (count === 0) return 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < count; i += 1) {
    cx += points[i * 3] ?? 0;
    cy += points[i * 3 + 1] ?? 0;
    cz += points[i * 3 + 2] ?? 0;
  }
  cx /= count;
  cy /= count;
  cz /= count;
  let radius = 0;
  for (let i = 0; i < count; i += 1) {
    const distance = Math.hypot((points[i * 3] ?? 0) - cx, (points[i * 3 + 1] ?? 0) - cy, (points[i * 3 + 2] ?? 0) - cz);
    if (distance > radius) radius = distance;
  }
  return radius;
}

/**
 * Maps the camera-facing side of `normal` onto `up`.
 * The eigenvector sign is arbitrary; `towardCamera` picks the side the viewer sees.
 */
export function levelRotation(
  normal: THREE.Vector3,
  towardCamera: THREE.Vector3,
  up: THREE.Vector3,
): THREE.Quaternion {
  const facing = normal.clone();
  if (facing.lengthSq() < 1e-20) return new THREE.Quaternion();
  facing.normalize();
  if (facing.dot(towardCamera) < 0) facing.negate();
  const target = up.clone();
  if (target.lengthSq() < 1e-20) target.set(0, 1, 0);
  else target.normalize();
  return new THREE.Quaternion().setFromUnitVectors(facing, target);
}

/** Right-handed quarter turn about a world axis. `sign` is +1 or -1. */
export function quarterTurn(axis: 'x' | 'y' | 'z', sign: number): THREE.Quaternion {
  const direction = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0);
  return new THREE.Quaternion().setFromAxisAngle(direction, sign * (Math.PI / 2));
}

/** Snaps to an axis-aligned rotation when the angle is within 0.01°. */
export function snapOrientation(q: THREE.Quaternion): THREE.Quaternion {
  const source = q.clone().normalize();
  if (!Number.isFinite(source.w)) return new THREE.Quaternion();
  let best = AXIS_ROTATIONS[0] ?? new THREE.Quaternion();
  let bestDot = -1;
  for (const candidate of AXIS_ROTATIONS) {
    const dot = Math.abs(source.dot(candidate));
    if (dot > bestDot) {
      bestDot = dot;
      best = candidate;
    }
  }
  const angle = 2 * Math.acos(Math.min(1, bestDot));
  if (angle <= SNAP_RADIANS) return best.clone();
  return source;
}

export function isIdentityOrientation(q: THREE.Quaternion): boolean {
  const snapped = snapOrientation(q);
  return Math.hypot(snapped.x, snapped.y, snapped.z) <= 1e-8 && Math.abs(Math.abs(snapped.w) - 1) <= 1e-8;
}

/** Shortest rotation angle, in radians, from the identity. */
export function rotationAngle(q: THREE.Quaternion): number {
  const w = Math.min(1, Math.abs(q.w));
  return 2 * Math.acos(w);
}

export function orientationLabel(q: THREE.Quaternion): string {
  const snapped = snapOrientation(q);
  const radians = rotationAngle(snapped);
  const degrees = (radians * 180) / Math.PI;
  if (degrees < 0.01) return 'As in file';
  const nearest = Math.round(degrees);
  if ((nearest === 90 || nearest === 180) && Math.abs(degrees - nearest) < 0.05) {
    return `Turned ${nearest}° from file`;
  }
  return `Tilted ${degrees.toFixed(1)}° from file`;
}

/** Axis-aligned percentile box. Defaults drop the outer 1% on each side. */
export function robustBox(points: Float32Array, lo = 0.01, hi = 0.99): THREE.Box3 {
  const box = new THREE.Box3();
  const count = Math.floor(points.length / 3);
  if (count === 0) return box.makeEmpty();
  const xs = new Float64Array(count);
  const ys = new Float64Array(count);
  const zs = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    xs[i] = points[i * 3] ?? 0;
    ys[i] = points[i * 3 + 1] ?? 0;
    zs[i] = points[i * 3 + 2] ?? 0;
  }
  xs.sort();
  ys.sort();
  zs.sort();
  box.min.set(percentile(xs, lo), percentile(ys, lo), percentile(zs, lo));
  box.max.set(percentile(xs, hi), percentile(ys, hi), percentile(zs, hi));
  return box;
}

/** `name|size` for a local file. The URL for a remote or sample source. */
export function uprightKey(source: Pick<AssetSource, 'origin' | 'name' | 'sizeBytes' | 'url'>): string {
  if (source.origin === 'file') return `${source.name}|${source.sizeBytes ?? 0}`;
  return source.url ?? source.name;
}

export function readUpright(storage: Pick<UprightStorage, 'getItem'>): UprightMap {
  return parseUpright(storage.getItem(UPRIGHT_KEY));
}

/** Writes one entry, or deletes it when `entry` is null. Keeps the 32 newest. */
export function writeUpright(storage: UprightStorage, key: string, entry: UprightEntry | null): UprightMap {
  const map = readUpright(storage);
  if (entry == null) delete map[key];
  else map[key] = entry;
  const trimmed = capUpright(map);
  storage.setItem(UPRIGHT_KEY, JSON.stringify(trimmed));
  return trimmed;
}

function capUpright(map: UprightMap): UprightMap {
  const keys = Object.keys(map);
  if (keys.length <= UPRIGHT_CAP) return map;
  keys.sort((a, b) => (map[a]?.at ?? 0) - (map[b]?.at ?? 0));
  const next: UprightMap = {};
  for (const key of keys.slice(keys.length - UPRIGHT_CAP)) {
    const entry = map[key];
    if (entry) next[key] = entry;
  }
  return next;
}

function parseUpright(raw: string | null): UprightMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const map: UprightMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      const entry = asEntry(value);
      if (entry) map[key] = entry;
    }
    return map;
  } catch {
    return {};
  }
}

function asEntry(value: unknown): UprightEntry | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { q?: unknown; up?: unknown; at?: unknown };
  if (!Array.isArray(record.q) || record.q.length !== 4) return null;
  const q = record.q.map((part) => Number(part));
  if (q.some((part) => !Number.isFinite(part))) return null;
  if (record.up !== 'y' && record.up !== 'z') return null;
  if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return null;
  return { q: [q[0] ?? 0, q[1] ?? 0, q[2] ?? 0, q[3] ?? 1], up: record.up, at: record.at };
}

function percentile(sorted: ArrayLike<number>, p: number): number {
  const count = sorted.length;
  if (count === 0) return 0;
  if (count === 1) return sorted[0] ?? 0;
  const clamped = Math.min(1, Math.max(0, p));
  const index = clamped * (count - 1);
  const lower = Math.floor(index);
  const upper = Math.min(count - 1, lower + 1);
  const span = index - lower;
  const a = sorted[lower] ?? 0;
  const b = sorted[upper] ?? a;
  return a + (b - a) * span;
}

/** Proper rotations that map the coordinate axes onto themselves. There are 24. */
function axisAlignedRotations(): THREE.Quaternion[] {
  const rotations: THREE.Quaternion[] = [];
  const permutations: number[][] = [
    [0, 1, 2],
    [1, 2, 0],
    [2, 0, 1],
    [0, 2, 1],
    [2, 1, 0],
    [1, 0, 2],
  ];
  const basis = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
  for (const perm of permutations) {
    const i0 = perm[0] ?? 0;
    const i1 = perm[1] ?? 1;
    const i2 = perm[2] ?? 2;
    const even = (i0 === 0 && i1 === 1) || (i0 === 1 && i1 === 2) || (i0 === 2 && i1 === 0);
    for (const sx of [1, -1]) {
      for (const sy of [1, -1]) {
        for (const sz of [1, -1]) {
          const det = (even ? 1 : -1) * sx * sy * sz;
          if (det !== 1) continue;
          const x = (basis[i0] ?? basis[0]).clone().multiplyScalar(sx);
          const y = (basis[i1] ?? basis[1]).clone().multiplyScalar(sy);
          const z = (basis[i2] ?? basis[2]).clone().multiplyScalar(sz);
          rotations.push(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)));
        }
      }
    }
  }
  return rotations;
}

interface Eigen3 {
  values: number[];
  vectors: number[][];
}

/** Cyclic Jacobi on a symmetric 3×3. Eigenvectors are columns of `vectors`. */
function jacobi3(matrix: number[][]): Eigen3 {
  const a = [
    [matrix[0]?.[0] ?? 0, matrix[0]?.[1] ?? 0, matrix[0]?.[2] ?? 0],
    [matrix[1]?.[0] ?? 0, matrix[1]?.[1] ?? 0, matrix[1]?.[2] ?? 0],
    [matrix[2]?.[0] ?? 0, matrix[2]?.[1] ?? 0, matrix[2]?.[2] ?? 0],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 16; sweep += 1) {
    for (let p = 0; p < 3; p += 1) {
      for (let q = p + 1; q < 3; q += 1) {
        const apq = a[p]?.[q] ?? 0;
        if (Math.abs(apq) < 1e-18) continue;
        const app = a[p]?.[p] ?? 0;
        const aqq = a[q]?.[q] ?? 0;
        const tau = (aqq - app) / (2 * apq);
        const t = tau === 0 ? 1 : Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau * tau));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        const next = a[p];
        const nextQ = a[q];
        if (next) next[p] = app - t * apq;
        if (nextQ) nextQ[q] = aqq + t * apq;
        if (next) next[q] = 0;
        if (nextQ) nextQ[p] = 0;
        for (let r = 0; r < 3; r += 1) {
          if (r === p || r === q) continue;
          const row = a[r];
          const arp = row?.[p] ?? 0;
          const arq = row?.[q] ?? 0;
          const rp = c * arp - s * arq;
          const rq = s * arp + c * arq;
          if (row) {
            row[p] = rp;
            row[q] = rq;
          }
          const colP = a[p];
          const colQ = a[q];
          if (colP) colP[r] = rp;
          if (colQ) colQ[r] = rq;
        }
        for (let r = 0; r < 3; r += 1) {
          const row = v[r];
          if (!row) continue;
          const vrp = row[p] ?? 0;
          const vrq = row[q] ?? 0;
          row[p] = c * vrp - s * vrq;
          row[q] = s * vrp + c * vrq;
        }
      }
    }
  }
  return {
    values: [a[0]?.[0] ?? 0, a[1]?.[1] ?? 0, a[2]?.[2] ?? 0],
    vectors: [
      [v[0]?.[0] ?? 1, v[1]?.[0] ?? 0, v[2]?.[0] ?? 0],
      [v[0]?.[1] ?? 0, v[1]?.[1] ?? 1, v[2]?.[1] ?? 0],
      [v[0]?.[2] ?? 0, v[1]?.[2] ?? 0, v[2]?.[2] ?? 1],
    ],
  };
}
