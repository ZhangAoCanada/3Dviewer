import type { SplatMesh } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { halfToFloat } from './coarseSurface';
import { isSplatObject } from './scenePick';

const MAX_AXIS = 1024;
const NEAR_PIXELS = 3.5;
const FAR_PIXELS = 14;
const MAX_TESTS = 100_000;
const MIN_PICK_OPACITY = 0.1;
const MIN_SUPPORT = 3;
const CANDIDATE_CAP = 2048;
const INDEX_CHUNK = 8_000;

const HALF = new Float32Array(65536);
for (let i = 0; i < 65536; i += 1) HALF[i] = halfToFloat(i);
const placed = { x: 0, y: 0, z: 0 };

interface IndexSource {
  count: number;
  base: number;
  matrix: Float64Array | null;
  packed?: Uint32Array;
  ext?: Float32Array;
  /** Uint32 view of `ext`, so word 3 keeps the half-float opacity bits. */
  extBits?: Uint32Array;
  positions?: { getX(index: number): number; getY(index: number): number; getZ(index: number): number };
}

/**
 * Every splat (or point) center, bucketed so a cursor pick tests the cells
 * along the ray instead of the whole cloud. The hit is the point on the ray
 * at the depth of the front-most center under the cursor pixel.
 */
export class SplatIndex {
  readonly count: number;
  private readonly seen: Uint32Array;
  private stamp = 1;

  private readonly candT = new Float64Array(CANDIDATE_CAP);
  private readonly candNear = new Uint8Array(CANDIDATE_CAP);

  constructor(
    private readonly sources: IndexSource[],
    private readonly offsets: Uint32Array,
    private readonly indices: Uint32Array,
    private readonly minX: number,
    private readonly minY: number,
    private readonly minZ: number,
    private readonly cell: number,
    private readonly nx: number,
    private readonly ny: number,
    private readonly nz: number,
  ) {
    this.count = indices.length;
    this.seen = new Uint32Array(Math.max(1, nx * ny * nz));
  }

  /** Occupied grid cells (`nx * ny * nz`), including empty ones. */
  get cells(): number {
    return this.nx * this.ny * this.nz;
  }

  static fromPositions(positions: Float32Array, box?: THREE.Box3, maxCells?: number): SplatIndex {
    return finishJob(SplatIndexJob.fromPositions(positions, box, maxCells));
  }

  /** Packed RGBA word 0, half-float centers. Used by the opacity pick test. */
  static fromPacked(packed: Uint32Array, box?: THREE.Box3, maxCells?: number): SplatIndex {
    const count = Math.floor(packed.length / 4);
    const source: IndexSource = { count, base: 0, matrix: null, packed };
    const bounds = box ?? boundsOf(source);
    return finishJob(new SplatIndexJob([source], bounds, maxCells));
  }

  /**
   * `forward` is the camera's world direction. `fov` is in radians.
   * Writes the cursor point into `target` and returns false when the ray
   * misses every center by more than `FAR_PIXELS`.
   */
  pick(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    forward: THREE.Vector3,
    fov: number,
    viewHeight: number,
    target: THREE.Vector3,
    minSupport = MIN_SUPPORT,
  ): boolean {
    const dx = direction.x;
    const dy = direction.y;
    const dz = direction.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-12) return false;
    const inv = 1 / len;
    const dirX = dx * inv;
    const dirY = dy * inv;
    const dirZ = dz * inv;
    const ox = origin.x;
    const oy = origin.y;
    const oz = origin.z;
    const forwardDot = dirX * forward.x + dirY * forward.y + dirZ * forward.z;
    const pixelScale = (2 * Math.tan(fov / 2)) / Math.max(1, viewHeight);

    const maxX = this.minX + this.nx * this.cell;
    const maxY = this.minY + this.ny * this.cell;
    const maxZ = this.minZ + this.nz * this.cell;
    const span = rayBox(ox, oy, oz, dirX, dirY, dirZ, this.minX, this.minY, this.minZ, maxX, maxY, maxZ);
    if (!span) return false;

    this.stamp += 1;
    if (this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }

    let bestNear = Infinity;
    let bestFar = Infinity;
    let supportedNear = Infinity;
    let supportedFar = Infinity;
    let stopT = Infinity;
    let candCount = 0;
    let tests = 0;
    const worldPerPixelAt = (t: number) => pixelScale * Math.max(1e-3, t * Math.abs(forwardDot));
    const widthAt = (t: number) => Math.max(0.02 * t, 2 * FAR_PIXELS * worldPerPixelAt(t));
    const consider = (index: number): boolean => {
      const located = locate(this.sources, index);
      if (!located) return false;
      if (opacityOf(located.source, located.local) < MIN_PICK_OPACITY) return false;
      const vx = placed.x - ox;
      const vy = placed.y - oy;
      const vz = placed.z - oz;
      const t = vx * dirX + vy * dirY + vz * dirZ;
      if (t < 1e-3 || t > stopT) return false;
      const perpX = vx - dirX * t;
      const perpY = vy - dirY * t;
      const perpZ = vz - dirZ * t;
      const perp2 = perpX * perpX + perpY * perpY + perpZ * perpZ;
      const worldPerPixel = worldPerPixelAt(t);
      const near = perp2 <= (worldPerPixel * NEAR_PIXELS) ** 2;
      if (perp2 > (worldPerPixel * FAR_PIXELS) ** 2) return false;
      if (near && t < bestNear) bestNear = t;
      if (t < bestFar) bestFar = t;
      if (candCount >= CANDIDATE_CAP) return false;
      this.candT[candCount] = t;
      this.candNear[candCount] = near ? 1 : 0;
      candCount += 1;
      return true;
    };

    let tEnter = Math.max(span.tNear, 0);
    const startX = ox + dirX * (tEnter + this.cell * 1e-4);
    const startY = oy + dirY * (tEnter + this.cell * 1e-4);
    const startZ = oz + dirZ * (tEnter + this.cell * 1e-4);
    let ix = clampIndex((startX - this.minX) / this.cell, this.nx);
    let iy = clampIndex((startY - this.minY) / this.cell, this.ny);
    let iz = clampIndex((startZ - this.minZ) / this.cell, this.nz);
    const stepX = dirX >= 0 ? 1 : -1;
    const stepY = dirY >= 0 ? 1 : -1;
    const stepZ = dirZ >= 0 ? 1 : -1;
    const tDeltaX = Math.abs(dirX) < 1e-12 ? Infinity : Math.abs(this.cell / dirX);
    const tDeltaY = Math.abs(dirY) < 1e-12 ? Infinity : Math.abs(this.cell / dirY);
    const tDeltaZ = Math.abs(dirZ) < 1e-12 ? Infinity : Math.abs(this.cell / dirZ);
    let tMaxX = boundaryT(ox, dirX, this.minX, ix, stepX, this.cell);
    let tMaxY = boundaryT(oy, dirY, this.minY, iy, stepY, this.cell);
    let tMaxZ = boundaryT(oz, dirZ, this.minZ, iz, stepZ, this.cell);
    const maxSteps = this.nx + this.ny + this.nz + 4;

    for (let step = 0; step < maxSteps; step += 1) {
      if (tEnter > stopT) break;
      let stop = false;
      let added = false;
      for (let ozCell = -1; ozCell <= 1 && !stop; ozCell += 1) {
        for (let oyCell = -1; oyCell <= 1 && !stop; oyCell += 1) {
          for (let oxCell = -1; oxCell <= 1; oxCell += 1) {
            const visit = this.visit(ix + oxCell, iy + oyCell, iz + ozCell, consider, tests);
            tests = visit.tests;
            if (visit.added) added = true;
            if (tests >= MAX_TESTS) {
              stop = true;
              break;
            }
          }
        }
      }
      if (added && candCount >= minSupport) {
        const resolved = resolveSupport(this.candT, this.candNear, candCount, widthAt, minSupport);
        supportedNear = resolved.nearT;
        supportedFar = resolved.farT;
        const bestSupported = Number.isFinite(supportedNear) ? supportedNear : supportedFar;
        if (Number.isFinite(bestSupported)) stopT = bestSupported + widthAt(bestSupported);
      }
      if (stop || tEnter > stopT) break;
      if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
        ix += stepX;
        if (ix < 0 || ix >= this.nx) break;
        tEnter = tMaxX;
        tMaxX += tDeltaX;
      } else if (tMaxY <= tMaxZ) {
        iy += stepY;
        if (iy < 0 || iy >= this.ny) break;
        tEnter = tMaxY;
        tMaxY += tDeltaY;
      } else {
        iz += stepZ;
        if (iz < 0 || iz >= this.nz) break;
        tEnter = tMaxZ;
        tMaxZ += tDeltaZ;
      }
      if (tEnter > span.tFar + this.cell) break;
    }

    const t = Number.isFinite(supportedNear)
      ? supportedNear
      : Number.isFinite(supportedFar)
        ? supportedFar
        : Number.isFinite(bestNear)
          ? bestNear
          : bestFar;
    if (!Number.isFinite(t)) return false;
    target.set(ox + dirX * t, oy + dirY * t, oz + dirZ * t);
    return true;
  }

  private visit(
    ix: number,
    iy: number,
    iz: number,
    consider: (globalIndex: number) => boolean,
    tests: number,
  ): { tests: number; added: boolean } {
    if (ix < 0 || iy < 0 || iz < 0 || ix >= this.nx || iy >= this.ny || iz >= this.nz) {
      return { tests, added: false };
    }
    const key = ix + this.nx * (iy + this.ny * iz);
    if (this.seen[key] === this.stamp) return { tests, added: false };
    this.seen[key] = this.stamp;
    const start = this.offsets[key] ?? 0;
    const end = this.offsets[key + 1] ?? start;
    let added = false;
    for (let i = start; i < end; i += 1) {
      if (consider(this.indices[i] ?? 0)) added = true;
      tests += 1;
      if (tests >= MAX_TESTS) return { tests, added };
    }
    return { tests, added };
  }
}

function finishJob(job: SplatIndexJob): SplatIndex {
  job.pump(1e9);
  const index = job.finish();
  if (!index) throw new Error('Splat index did not finish');
  return index;
}

/** Builds the index a few milliseconds at a time so a 14M cloud does not hitch. */
export class SplatIndexJob {
  private phase: 'hist' | 'prefix' | 'fill' | 'done' = 'hist';
  private sourceCursor = 0;
  private localCursor = 0;
  private readonly nx: number;
  private readonly ny: number;
  private readonly nz: number;
  private readonly cell: number;
  private readonly hist: Uint32Array;
  private offsets: Uint32Array | null = null;
  private indices: Uint32Array | null = null;
  private cursor: Uint32Array | null = null;
  private readonly total: number;
  private histDone = 0;
  private fillDone = 0;

  constructor(
    private readonly sources: IndexSource[],
    box: THREE.Box3,
    maxCells?: number,
  ) {
    const size = box.getSize(new THREE.Vector3());
    this.total = sources.reduce((sum, source) => sum + source.count, 0);
    const grid = gridFor(size, this.total, maxCells);
    this.cell = grid.cell;
    this.nx = grid.nx;
    this.ny = grid.ny;
    this.nz = grid.nz;
    this.hist = new Uint32Array(this.nx * this.ny * this.nz);
    this.minX = box.min.x;
    this.minY = box.min.y;
    this.minZ = box.min.z;
  }

  static fromPositions(positions: Float32Array, box?: THREE.Box3, maxCells?: number): SplatIndexJob {
    const count = Math.floor(positions.length / 3);
    const attribute = new THREE.BufferAttribute(positions, 3);
    const source: IndexSource = { count, base: 0, matrix: null, positions: attribute };
    const bounds = box ?? boundsOf(source);
    return new SplatIndexJob([source], bounds, maxCells);
  }

  private readonly minX: number;
  private readonly minY: number;
  private readonly minZ: number;

  get finished(): boolean {
    return this.phase === 'done';
  }

  /** Histogram and fill are weighted equally, so a finished job is 1. */
  get progress(): number {
    if (this.phase === 'done' || this.total <= 0) return 1;
    return (this.histDone + this.fillDone) / (2 * this.total);
  }

  /** Returns true when the index is ready. Each loop step is one chunk. */
  pump(budgetMs: number): boolean {
    const start = performance.now();
    const budget = Math.max(0, budgetMs);
    while (this.phase !== 'done') {
      if (this.phase === 'hist') this.stepHist();
      else if (this.phase === 'prefix') this.prefix();
      else this.stepFill();
      if (performance.now() - start >= budget) break;
    }
    return this.phase === 'done';
  }

  finish(): SplatIndex | null {
    if (this.phase !== 'done' || !this.offsets || !this.indices) return null;
    return new SplatIndex(
      this.sources,
      this.offsets,
      this.indices,
      this.minX,
      this.minY,
      this.minZ,
      this.cell,
      this.nx,
      this.ny,
      this.nz,
    );
  }

  private stepHist(): void {
    const source = this.sources[this.sourceCursor];
    if (!source) {
      this.phase = 'prefix';
      return;
    }
    const stop = Math.min(source.count, this.localCursor + INDEX_CHUNK);
    for (let i = this.localCursor; i < stop; i += 1) {
      const cell = this.cellOf(source, i);
      if (cell >= 0) this.hist[cell] += 1;
    }
    this.histDone += stop - this.localCursor;
    this.localCursor = stop;
    if (this.localCursor >= source.count) {
      this.sourceCursor += 1;
      this.localCursor = 0;
    }
    if (this.sourceCursor >= this.sources.length) this.phase = 'prefix';
  }

  private prefix(): void {
    const cells = this.hist.length;
    const offsets = new Uint32Array(cells + 1);
    let sum = 0;
    for (let i = 0; i < cells; i += 1) {
      offsets[i] = sum;
      sum += this.hist[i] ?? 0;
    }
    offsets[cells] = sum;
    this.offsets = offsets;
    this.cursor = offsets.slice(0, cells);
    this.indices = new Uint32Array(sum);
    this.sourceCursor = 0;
    this.localCursor = 0;
    this.phase = sum === 0 ? 'done' : 'fill';
  }

  private stepFill(): void {
    const { sources, indices, cursor } = this;
    if (!indices || !cursor) {
      this.phase = 'done';
      return;
    }
    const source = sources[this.sourceCursor];
    if (!source) {
      this.phase = 'done';
      return;
    }
    const stop = Math.min(source.count, this.localCursor + INDEX_CHUNK);
    for (let i = this.localCursor; i < stop; i += 1) {
      const cell = this.cellOf(source, i);
      if (cell < 0) continue;
      const slot = cursor[cell] ?? 0;
      indices[slot] = source.base + i;
      cursor[cell] = slot + 1;
    }
    this.fillDone += stop - this.localCursor;
    this.localCursor = stop;
    if (this.localCursor >= source.count) {
      this.sourceCursor += 1;
      this.localCursor = 0;
    }
    if (this.sourceCursor >= sources.length) this.phase = 'done';
  }

  private cellOf(source: IndexSource, local: number): number {
    if (!readWorld(source, local)) return -1;
    return (
      clampIndex((placed.x - this.minX) / this.cell, this.nx) +
      this.nx *
        (clampIndex((placed.y - this.minY) / this.cell, this.ny) +
          this.ny * clampIndex((placed.z - this.minZ) / this.cell, this.nz))
    );
  }
}

export function collectIndexSources(root: THREE.Object3D): IndexSource[] {
  const sources: IndexSource[] = [];
  let base = 0;
  root.updateWorldMatrix(true, true);
  root.traverse((object) => {
    const source = sourceFrom(object);
    if (!source || source.count <= 0) return;
    source.base = base;
    base += source.count;
    sources.push(source);
  });
  return sources;
}

function sourceFrom(object: THREE.Object3D): IndexSource | null {
  const matrix = identityMatrix(object.matrixWorld) ? null : Float64Array.from(object.matrixWorld.elements);
  if (isSplatObject(object)) {
    if ((object as SplatMesh).paged) return null;
    const ext = object.extSplats?.extArrays?.[0];
    const packed = object.packedSplats?.packedArray;
    const packedCount = packed ? packed.length / 4 : 0;
    const extCount = ext ? ext.length / 4 : 0;
    const count = object.numSplats || packedCount || extCount;
    if (ext) {
      return {
        count,
        base: 0,
        matrix,
        ext: new Float32Array(ext.buffer, ext.byteOffset, ext.length),
        extBits: new Uint32Array(ext.buffer, ext.byteOffset, ext.length),
      };
    }
    if (packed) return { count, base: 0, matrix, packed };
    return null;
  }
  const mesh = object as THREE.Mesh;
  const points = object as THREE.Points;
  if (!mesh.isMesh && !points.isPoints) return null;
  const positions = (mesh.geometry ?? points.geometry)?.getAttribute('position');
  if (!positions) return null;
  return { count: positions.count, base: 0, matrix, positions };
}

function locate(sources: IndexSource[], globalIndex: number): { source: IndexSource; local: number } | null {
  for (const source of sources) {
    if (globalIndex < source.base + source.count) {
      const local = globalIndex - source.base;
      if (!readWorld(source, local)) return null;
      return { source, local };
    }
  }
  return null;
}

function opacityOf(source: IndexSource, local: number): number {
  if (source.packed) return ((source.packed[local * 4] ?? 0) >>> 24) / 255;
  if (source.extBits) return HALF[(source.extBits[local * 4 + 3] ?? 0) & 65535] ?? 0;
  return 1;
}

function readWorld(source: IndexSource, local: number): boolean {
  let x = 0;
  let y = 0;
  let z = 0;
  if (source.ext) {
    const o = local * 4;
    x = source.ext[o] ?? 0;
    y = source.ext[o + 1] ?? 0;
    z = source.ext[o + 2] ?? 0;
  } else if (source.packed) {
    const o = local * 4;
    const xy = source.packed[o + 1] ?? 0;
    const zw = source.packed[o + 2] ?? 0;
    x = HALF[xy & 65535] ?? 0;
    y = HALF[xy >>> 16] ?? 0;
    z = HALF[zw & 65535] ?? 0;
  } else if (source.positions) {
    x = source.positions.getX(local);
    y = source.positions.getY(local);
    z = source.positions.getZ(local);
  }
  const m = source.matrix;
  if (m) {
    const wx = (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0);
    const wy = (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0);
    const wz = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0);
    x = wx;
    y = wy;
    z = wz;
  }
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
  placed.x = x;
  placed.y = y;
  placed.z = z;
  return true;
}

function boundsOf(source: IndexSource): THREE.Box3 {
  const box = new THREE.Box3();
  if (source.count <= 0) return box;
  let seeded = false;
  for (let i = 0; i < source.count; i += 1) {
    if (!readWorld(source, i)) continue;
    if (!seeded) {
      box.min.set(placed.x, placed.y, placed.z);
      box.max.set(placed.x, placed.y, placed.z);
      seeded = true;
      continue;
    }
    if (placed.x < box.min.x) box.min.x = placed.x;
    if (placed.y < box.min.y) box.min.y = placed.y;
    if (placed.z < box.min.z) box.min.z = placed.z;
    if (placed.x > box.max.x) box.max.x = placed.x;
    if (placed.y > box.max.y) box.max.y = placed.y;
    if (placed.z > box.max.z) box.max.z = placed.z;
  }
  return box;
}

function identityMatrix(matrix: THREE.Matrix4): boolean {
  const e = matrix.elements;
  return (
    e[0] === 1 &&
    e[5] === 1 &&
    e[10] === 1 &&
    e[15] === 1 &&
    e[1] === 0 &&
    e[2] === 0 &&
    e[3] === 0 &&
    e[4] === 0 &&
    e[6] === 0 &&
    e[7] === 0 &&
    e[8] === 0 &&
    e[9] === 0 &&
    e[11] === 0 &&
    e[12] === 0 &&
    e[13] === 0 &&
    e[14] === 0
  );
}

function axisCount(size: number, cell: number): number {
  return Math.max(1, Math.min(MAX_AXIS, Math.ceil(Math.max(size, 1e-4) / cell)));
}

/** `cells ≤ max(4096, count / 8)`, and `n * cell` covers every axis. */
export function gridFor(
  size: THREE.Vector3,
  count: number,
  maxCells = Math.max(4096, count / 8),
): { cell: number; nx: number; ny: number; nz: number } {
  const sx = Math.max(size.x, 1e-4);
  const sy = Math.max(size.y, 1e-4);
  const sz = Math.max(size.z, 1e-4);
  let cell = Math.cbrt((sx * sy * sz) / maxCells);
  if (!Number.isFinite(cell) || cell <= 0) cell = Math.max(sx, sy, sz) / MAX_AXIS;
  cell = Math.max(cell, Math.max(sx, sy, sz) / MAX_AXIS);
  let nx = axisCount(sx, cell);
  let ny = axisCount(sy, cell);
  let nz = axisCount(sz, cell);
  for (let guard = 0; guard < 32 && nx * ny * nz > maxCells; guard += 1) {
    cell *= Math.cbrt((nx * ny * nz) / maxCells) * 1.0000001;
    nx = axisCount(sx, cell);
    ny = axisCount(sy, cell);
    nz = axisCount(sz, cell);
  }
  return { cell, nx, ny, nz };
}

function resolveSupport(
  values: Float64Array,
  near: Uint8Array,
  n: number,
  widthAt: (depth: number) => number,
  minSupport: number,
): { nearT: number; farT: number } {
  const order = new Array<number>(n);
  for (let i = 0; i < n; i += 1) order[i] = i;
  order.sort((a, b) => (values[a] ?? 0) - (values[b] ?? 0));
  const depth = new Float64Array(n);
  const flags = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const src = order[i] ?? 0;
    depth[i] = values[src] ?? 0;
    flags[i] = near[src] ?? 0;
  }
  let nearT = Infinity;
  let farT = Infinity;
  for (let i = 0; i < n; i += 1) {
    const ti = depth[i] ?? 0;
    const w = widthAt(ti);
    const count = upperBound(depth, n, ti + w) - lowerBound(depth, n, ti - w);
    if (count < minSupport) continue;
    if (flags[i] === 1 && ti < nearT) nearT = ti;
    if (ti < farT) farT = ti;
    if (Number.isFinite(nearT)) break;
  }
  return { nearT, farT };
}

function lowerBound(values: Float64Array, n: number, bound: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] ?? 0) < bound) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(values: Float64Array, n: number, bound: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] ?? 0) <= bound) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function clampIndex(value: number, size: number): number {
  return Math.max(0, Math.min(size - 1, Math.floor(value)));
}

function boundaryT(origin: number, dir: number, min: number, index: number, step: number, cell: number): number {
  if (Math.abs(dir) < 1e-12) return Infinity;
  const next = min + (index + (step > 0 ? 1 : 0)) * cell;
  return (next - origin) / dir;
}

function rayBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): { tNear: number; tFar: number } | null {
  let tNear = -Infinity;
  let tFar = Infinity;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const b0 = [minX, minY, minZ];
  const b1 = [maxX, maxY, maxZ];
  for (let axis = 0; axis < 3; axis += 1) {
    const origin = o[axis] ?? 0;
    const dir = d[axis] ?? 0;
    const min = b0[axis] ?? 0;
    const max = b1[axis] ?? 0;
    if (Math.abs(dir) < 1e-12) {
      if (origin < min || origin > max) return null;
      continue;
    }
    let t0 = (min - origin) / dir;
    let t1 = (max - origin) / dir;
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
