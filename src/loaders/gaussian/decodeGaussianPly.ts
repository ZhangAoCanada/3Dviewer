import type { ByteSource } from '../../core/byteSource';
import type { GaussianLoadOverrides, MemoryBudget } from '../../core/types';
import {
  paddedSplatCount,
  planGaussianDecode,
  type GaussianDecodePlan,
  type ShDegree,
} from './gaussianPlan';
import {
  DEFAULT_LIMITS,
  type SplatEncodingLimits,
  writeExtSh1,
  writeExtSh2,
  writeExtSh3,
  writeExtSplat,
  writePackedSh1,
  writePackedSh2,
  writePackedSh3,
  writePackedSplat,
} from './packSplat';

const SH_C0 = 0.28209479177387814;
const HEADER_PROBE = 1024 * 1024;
const DEFAULT_CHUNK = 8 * 1024 * 1024;
const RESERVOIR = 65_536;

const TYPE_SIZE: Record<string, number> = {
  char: 1,
  uchar: 1,
  int8: 1,
  uint8: 1,
  short: 2,
  ushort: 2,
  int16: 2,
  uint16: 2,
  int: 4,
  uint: 4,
  int32: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

export class GaussianPlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GaussianPlyError';
  }
}

/** Not a plain INRIA gaussian PLY. The Spark file decoder may still own it. */
export class GaussianPlyUnsupported extends GaussianPlyError {
  constructor(message: string) {
    super(message);
    this.name = 'GaussianPlyUnsupported';
  }
}

export interface GaussianGeoref {
  offsetX?: string;
  offsetY?: string;
  offsetZ?: string;
  epsg?: string;
  minX?: string;
  minY?: string;
  minZ?: string;
  maxX?: string;
  maxY?: string;
  maxZ?: string;
}

export interface GaussianPlyHeader {
  text: string;
  byteLength: number;
  little: boolean;
  headerCount: number;
  stride: number;
  fast: boolean;
  sourceSh: ShDegree;
  /** f_rest floats per color channel. 0 when the file is DC only. */
  nRest: number;
  georef: GaussianGeoref;
  layout: PropLayout;
}

interface Prop {
  name: string;
  type: string;
  size: number;
  offset: number;
}

interface PropLayout {
  x: number;
  y: number;
  z: number;
  dc0: number;
  dc1: number;
  dc2: number;
  opacity: number;
  scale0: number;
  scale1: number;
  scale2: number;
  rot0: number;
  rot1: number;
  rot2: number;
  rot3: number;
  restBase: number;
  types: Record<string, string>;
}

export interface VertexCountResolution {
  count: number;
  mismatch: boolean;
}

/**
 * When the vertex stride divides the bytes after the header, that quotient is
 * the splat count. A copied `element vertex` line (the drone export writes
 * the sibling cloud's count) must not clip or overrun the body.
 */
export function resolveVertexCount(
  headerCount: number,
  headerBytes: number,
  fileSize: number,
  stride: number,
): VertexCountResolution {
  if (!Number.isFinite(stride) || stride <= 0) {
    throw new GaussianPlyError('Gaussian PLY vertex stride is zero.');
  }
  const body = fileSize - headerBytes;
  if (body < 0) throw new GaussianPlyError('Gaussian PLY header is longer than the file.');
  if (body % stride === 0) {
    const count = body / stride;
    return { count, mismatch: count !== headerCount };
  }
  if (headerCount >= 0 && headerCount * stride <= body) {
    return { count: headerCount, mismatch: false };
  }
  throw new GaussianPlyError(
    `Gaussian PLY body is ${body.toLocaleString()} bytes, which is not a whole number of ${stride}-byte splats, and the header count ${headerCount.toLocaleString()} does not fit.`,
  );
}

export interface DecodeProgress {
  loaded: number;
  total: number;
  message: string;
}

export interface GaussianBounds {
  min: [number, number, number];
  max: [number, number, number];
}

export interface DecodeGaussianOptions {
  budget: MemoryBudget;
  /** Float32 centers when the budget can hold them. */
  preferExtended: boolean;
  chunkBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DecodeProgress) => void;
  limits?: SplatEncodingLimits;
  overrides?: GaussianLoadOverrides;
}

export interface DecodedGaussian {
  count: number;
  sourceCount: number;
  headerCount: number;
  stride: number;
  shDegree: ShDegree;
  sourceSh: ShDegree;
  extended: boolean;
  limits: SplatEncodingLimits;
  packedArray?: Uint32Array;
  extArrays?: [Uint32Array, Uint32Array];
  sh1?: Uint32Array;
  sh2?: Uint32Array;
  sh3?: Uint32Array;
  sh3b?: Uint32Array;
  georef: GaussianGeoref;
  warning?: string;
  notes: string[];
  decodedBytes: number;
  lod: boolean;
  mismatch: boolean;
  /** Local-space centers, after subtracting `origin`. */
  bounds: GaussianBounds;
  robustBounds: GaussianBounds;
  origin: [number, number, number];
}

export async function inspectGaussianPly(source: ByteSource): Promise<GaussianPlyHeader | null> {
  try {
    return await readGaussianPlyHeader(source);
  } catch (error) {
    if (error instanceof GaussianPlyUnsupported) return null;
    throw error;
  }
}

export async function readGaussianPlyHeader(source: ByteSource): Promise<GaussianPlyHeader> {
  const cap = Math.min(source.size, HEADER_PROBE);
  const bytes = new Uint8Array(await source.read(0, cap));
  const text = new TextDecoder('latin1').decode(bytes);
  if (!text.trimStart().toLowerCase().startsWith('ply')) {
    throw new GaussianPlyUnsupported('Not a PLY file.');
  }
  const marker = 'end_header';
  const idx = text.indexOf(marker);
  if (idx < 0) throw new GaussianPlyError('PLY header is missing end_header.');
  let byteLength = idx + marker.length;
  if (text.charCodeAt(byteLength) === 13) byteLength += 1;
  if (text.charCodeAt(byteLength) === 10) byteLength += 1;
  const header = text.slice(0, idx + marker.length);
  const lower = header.toLowerCase();
  if (lower.includes('element chunk') || lower.includes('element sh')) {
    throw new GaussianPlyUnsupported('Compressed or chunked gaussian PLY is decoded by Spark.');
  }
  const formatLine = header.match(/format\s+(\S+)/i);
  const format = formatLine?.[1]?.toLowerCase();
  if (format === 'ascii') {
    throw new GaussianPlyUnsupported('ASCII gaussian PLY is decoded by Spark.');
  }
  if (format !== 'binary_little_endian' && format !== 'binary_big_endian') {
    throw new GaussianPlyUnsupported(`Unsupported PLY format${format ? `: ${format}` : ''}.`);
  }

  const vertex = parseVertex(header);
  if (!vertex) throw new GaussianPlyUnsupported('PLY has no vertex element.');
  const layout = layoutOf(vertex.props);
  if (!layout) throw new GaussianPlyUnsupported('PLY is missing 3DGS properties (f_dc, scale, rot, opacity).');
  const little = format === 'binary_little_endian';
  const fast = little && vertex.props.every((prop) => prop.size === 4 && (prop.type === 'float' || prop.type === 'float32'));
  const rest = shLayout(vertex.props);
  return {
    text: header,
    byteLength,
    little,
    headerCount: Number.isFinite(vertex.count) ? vertex.count : 0,
    stride: vertex.bytes,
    fast,
    sourceSh: rest.degree,
    nRest: rest.nRest,
    georef: parseGeoref(header),
    layout,
  };
}

export async function decodeGaussianPly(source: ByteSource, options: DecodeGaussianOptions): Promise<DecodedGaussian> {
  const header = await readGaussianPlyHeader(source);
  throwIfAborted(options.signal);
  const resolved = resolveVertexCount(header.headerCount, header.byteLength, source.size, header.stride);
  const plan = planGaussianDecode({
    sourceCount: resolved.count,
    sourceSh: header.sourceSh,
    budget: options.budget,
    preferExtended: options.preferExtended,
    overrides: options.overrides,
  });
  if (plan.decodedCount <= 0) {
    throw new GaussianPlyError('Gaussian PLY contains no splats.');
  }

  const padded = paddedSplatCount(plan.decodedCount);
  let packedArray: Uint32Array | undefined;
  let extArrays: [Uint32Array, Uint32Array] | undefined;
  let sh1: Uint32Array | undefined;
  let sh2: Uint32Array | undefined;
  let sh3: Uint32Array | undefined;
  let sh3b: Uint32Array | undefined;
  try {
    if (plan.extended) {
      extArrays = [new Uint32Array(padded * 4), new Uint32Array(padded * 4)];
      if (plan.shDegree >= 1) sh1 = new Uint32Array(padded * 4);
      if (plan.shDegree >= 2) sh2 = new Uint32Array(padded * 4);
      if (plan.shDegree >= 3) {
        sh3 = new Uint32Array(padded * 4);
        sh3b = new Uint32Array(padded * 4);
      }
    } else {
      packedArray = new Uint32Array(padded * 4);
      if (plan.shDegree >= 1) sh1 = new Uint32Array(padded * 2);
      if (plan.shDegree >= 2) sh2 = new Uint32Array(padded * 4);
      if (plan.shDegree >= 3) sh3 = new Uint32Array(padded * 4);
    }
  } catch (error) {
    if (error instanceof RangeError) {
      throw new GaussianPlyError(
        `Not enough memory to decode ${plan.decodedCount.toLocaleString()} splats (about ${formatMiB(plan.estimatedBytes)}). Close other tabs or load a smaller scene.`,
      );
    }
    throw error;
  }

  const sh1Scratch = plan.shDegree >= 1 ? new Float32Array(9) : null;
  const sh2Scratch = plan.shDegree >= 2 ? new Float32Array(15) : null;
  const sh3Scratch = plan.shDegree >= 3 ? new Float32Array(21) : null;
  const chunkBytes = Math.max(header.stride, options.chunkBytes ?? DEFAULT_CHUNK);
  const aligned = chunkBytes - (chunkBytes % header.stride);
  let filePos = header.byteLength;
  const end = header.byteLength + resolved.count * header.stride;
  const firstTake = Math.min(aligned, end - filePos);
  const firstBuf = await source.read(filePos, filePos + firstTake);
  throwIfAborted(options.signal);
  const stats = scanChunk(firstBuf, header);
  const finite = stats.finite;
  const meanX = finite > 0 ? stats.sumX / finite : 0;
  const meanY = finite > 0 ? stats.sumY / finite : 0;
  const meanZ = finite > 0 ? stats.sumZ / finite : 0;
  const originX = midpoint(header.georef.minX, header.georef.maxX) ?? meanX;
  const originY = midpoint(header.georef.minY, header.georef.maxY) ?? meanY;
  const originZ = midpoint(header.georef.minZ, header.georef.maxZ) ?? meanZ;
  const limits = options.limits ?? limitsFrom(stats);
  const accum: DecodeAccum = {
    originX,
    originY,
    originZ,
    minX: Infinity,
    minY: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    maxZ: -Infinity,
    reservoir: new Float32Array(RESERVOIR * 3),
    seen: 0,
    reservoirNext: Number.POSITIVE_INFINITY,
    reservoirW: 1,
    skippedNonFinite: 0,
  };
  let kept = 0;
  let lastReport = 0;
  const report = (scanned: number, force = false) => {
    const now = performance.now();
    if (!force && now - lastReport < 150) return;
    lastReport = now;
    options.onProgress?.({
      loaded: scanned,
      total: resolved.count,
      message: `Decoding ${scanned.toLocaleString()} / ${resolved.count.toLocaleString()} splats`,
    });
  };
  report(0, true);

  let pending: Promise<ArrayBuffer> | null = Promise.resolve(firstBuf);
  while (pending && filePos < end) {
    throwIfAborted(options.signal);
    const buf = await pending;
    const base = (filePos - header.byteLength) / header.stride;
    const verts = Math.floor(buf.byteLength / header.stride);
    if (verts <= 0) break;
    const nextPos = filePos + verts * header.stride;
    if (nextPos < end) {
      const take = Math.min(aligned, end - nextPos);
      pending = source.read(nextPos, nextPos + take);
    } else {
      pending = null;
    }
    if (header.fast) {
      kept = consumeFloats(
        new Float32Array(buf),
        verts,
        base,
        header,
        plan,
        limits,
        kept,
        accum,
        packedArray,
        extArrays,
        sh1,
        sh2,
        sh3,
        sh3b,
        sh1Scratch,
        sh2Scratch,
        sh3Scratch,
      );
    } else {
      kept = consumeView(
        new DataView(buf),
        verts,
        base,
        header,
        plan,
        limits,
        kept,
        accum,
        packedArray,
        extArrays,
        sh1,
        sh2,
        sh3,
        sh3b,
        sh1Scratch,
        sh2Scratch,
        sh3Scratch,
      );
    }
    filePos = nextPos;
    report(Math.min(resolved.count, base + verts));
  }
  report(resolved.count, true);

  const notes = [...plan.notes];
  if (accum.skippedNonFinite > 0) {
    const skipped = accum.skippedNonFinite;
    notes.push(
      `Skipped ${skipped.toLocaleString()} ${skipped === 1 ? 'splat' : 'splats'} with non-finite centers.`,
    );
  }
  let warning: string | undefined;
  if (resolved.mismatch) {
    warning = `PLY header says ${header.headerCount.toLocaleString()} splats, but the file body holds ${resolved.count.toLocaleString()}. Loaded the body.`;
  }
  if (notes.length > 0) {
    const extra = notes.join(' ');
    warning = warning ? `${warning} ${extra}` : extra;
  }

  return {
    count: kept,
    sourceCount: resolved.count,
    headerCount: header.headerCount,
    stride: plan.stride,
    shDegree: plan.shDegree,
    sourceSh: header.sourceSh,
    extended: plan.extended,
    limits,
    packedArray,
    extArrays,
    sh1,
    sh2,
    sh3,
    sh3b,
    georef: header.georef,
    warning,
    notes,
    decodedBytes: plan.estimatedBytes,
    lod: plan.lod,
    mismatch: resolved.mismatch,
    bounds: axisBounds(accum),
    robustBounds: robustBounds(accum),
    origin: [originX, originY, originZ],
  };
}

/** Packed float32 path. Locals stay unboxed; the shared Sample object is for the other paths. */
function consumePackedFloats(
  floats: Float32Array,
  verts: number,
  base: number,
  header: GaussianPlyHeader,
  plan: GaussianDecodePlan,
  limits: SplatEncodingLimits,
  kept: number,
  accum: DecodeAccum,
  packed: Uint32Array,
  sh1: Uint32Array | undefined,
  sh2: Uint32Array | undefined,
  sh3: Uint32Array | undefined,
  sh1Scratch: Float32Array | null,
  sh2Scratch: Float32Array | null,
  sh3Scratch: Float32Array | null,
): number {
  const stride = header.stride >> 2;
  const layout = header.layout;
  const xw = layout.x >> 2;
  const yw = layout.y >> 2;
  const zw = layout.z >> 2;
  const dc0 = layout.dc0 >> 2;
  const dc1 = layout.dc1 >> 2;
  const dc2 = layout.dc2 >> 2;
  const opacityW = layout.opacity >> 2;
  const scale0 = layout.scale0 >> 2;
  const scale1 = layout.scale1 >> 2;
  const scale2 = layout.scale2 >> 2;
  const rot0 = layout.rot0 >> 2;
  const rot1 = layout.rot1 >> 2;
  const rot2 = layout.rot2 >> 2;
  const rot3 = layout.rot3 >> 2;
  const restW = layout.restBase >> 2;
  const step = plan.stride;
  const sh = plan.shDegree;
  const nRest = header.nRest;
  const collect = sh1Scratch !== null && nRest >= 3 && layout.restBase >= 0;
  const ox = accum.originX;
  const oy = accum.originY;
  const oz = accum.originZ;
  for (let i = 0; i < verts; i += 1) {
    const index = base + i;
    if (step > 1 && index % step !== 0) continue;
    const at = i * stride;
    const x = floats[at + xw]! - ox;
    const y = floats[at + yw]! - oy;
    const z = floats[at + zw]! - oz;
    if (!Number.isFinite(x + y + z)) {
      accum.skippedNonFinite += 1;
      continue;
    }
    rememberCenter(accum, x, y, z);
    const r = 0.5 + SH_C0 * floats[at + dc0]!;
    const g = 0.5 + SH_C0 * floats[at + dc1]!;
    const b = 0.5 + SH_C0 * floats[at + dc2]!;
    const opacity = sigmoid(floats[at + opacityW]!);
    const sx = Math.exp(floats[at + scale0]!);
    const sy = Math.exp(floats[at + scale1]!);
    const sz = Math.exp(floats[at + scale2]!);
    const qw = floats[at + rot0]!;
    const qx = floats[at + rot1]!;
    const qy = floats[at + rot2]!;
    const qz = floats[at + rot3]!;
    writePackedSplat(packed, kept, x, y, z, sx, sy, sz, qx, qy, qz, qw, opacity, r, g, b, limits);
    if (collect && sh1Scratch) {
      fillRestFloats(floats, at + restW, nRest, sh, sh1Scratch, sh2Scratch, sh3Scratch);
      if (sh >= 1 && sh1) writePackedSh1(sh1, kept, sh1Scratch, limits.sh1Max);
      if (sh >= 2 && sh2 && sh2Scratch) writePackedSh2(sh2, kept, sh2Scratch, limits.sh2Max);
      if (sh >= 3 && sh3 && sh3Scratch) writePackedSh3(sh3, kept, sh3Scratch, limits.sh3Max);
    }
    kept += 1;
  }
  return kept;
}

function consumeFloats(
  floats: Float32Array,
  verts: number,
  base: number,
  header: GaussianPlyHeader,
  plan: GaussianDecodePlan,
  limits: SplatEncodingLimits,
  kept: number,
  accum: DecodeAccum,
  packed: Uint32Array | undefined,
  ext: [Uint32Array, Uint32Array] | undefined,
  sh1: Uint32Array | undefined,
  sh2: Uint32Array | undefined,
  sh3: Uint32Array | undefined,
  sh3b: Uint32Array | undefined,
  sh1Scratch: Float32Array | null,
  sh2Scratch: Float32Array | null,
  sh3Scratch: Float32Array | null,
): number {
  if (packed && !plan.extended) {
    return consumePackedFloats(
      floats,
      verts,
      base,
      header,
      plan,
      limits,
      kept,
      accum,
      packed,
      sh1,
      sh2,
      sh3,
      sh1Scratch,
      sh2Scratch,
      sh3Scratch,
    );
  }
  const stride = header.stride / 4;
  const layout = header.layout;
  const step = plan.stride;
  for (let i = 0; i < verts; i += 1) {
    const index = base + i;
    if (step > 1 && index % step !== 0) continue;
    readFloats(floats, i * stride, layout, header.nRest, plan.shDegree, sh1Scratch, sh2Scratch, sh3Scratch);
    if (!acceptSample(accum)) continue;
    writeSample(kept, sample, plan, limits, packed, ext, sh1, sh2, sh3, sh3b);
    kept += 1;
  }
  return kept;
}

function consumeView(
  view: DataView,
  verts: number,
  base: number,
  header: GaussianPlyHeader,
  plan: GaussianDecodePlan,
  limits: SplatEncodingLimits,
  kept: number,
  accum: DecodeAccum,
  packed: Uint32Array | undefined,
  ext: [Uint32Array, Uint32Array] | undefined,
  sh1: Uint32Array | undefined,
  sh2: Uint32Array | undefined,
  sh3: Uint32Array | undefined,
  sh3b: Uint32Array | undefined,
  sh1Scratch: Float32Array | null,
  sh2Scratch: Float32Array | null,
  sh3Scratch: Float32Array | null,
): number {
  const layout = header.layout;
  const step = plan.stride;
  const little = header.little;
  const types = layout.types;
  const tx = types.x ?? 'float';
  const ty = types.y ?? 'float';
  const tz = types.z ?? 'float';
  const tdc0 = types.f_dc_0 ?? 'float';
  const tdc1 = types.f_dc_1 ?? 'float';
  const tdc2 = types.f_dc_2 ?? 'float';
  const tOpacity = types.opacity ?? 'float';
  const tScale0 = types.scale_0 ?? 'float';
  const tScale1 = types.scale_1 ?? 'float';
  const tScale2 = types.scale_2 ?? 'float';
  const tRot0 = types.rot_0 ?? 'float';
  const tRot1 = types.rot_1 ?? 'float';
  const tRot2 = types.rot_2 ?? 'float';
  const tRot3 = types.rot_3 ?? 'float';
  for (let i = 0; i < verts; i += 1) {
    const index = base + i;
    if (step > 1 && index % step !== 0) continue;
    const at = i * header.stride;
    sample.x = readScalar(view, at + layout.x, tx, little);
    sample.y = readScalar(view, at + layout.y, ty, little);
    sample.z = readScalar(view, at + layout.z, tz, little);
    sample.r = 0.5 + SH_C0 * readScalar(view, at + layout.dc0, tdc0, little);
    sample.g = 0.5 + SH_C0 * readScalar(view, at + layout.dc1, tdc1, little);
    sample.b = 0.5 + SH_C0 * readScalar(view, at + layout.dc2, tdc2, little);
    sample.opacity = sigmoid(readScalar(view, at + layout.opacity, tOpacity, little));
    sample.sx = Math.exp(readScalar(view, at + layout.scale0, tScale0, little));
    sample.sy = Math.exp(readScalar(view, at + layout.scale1, tScale1, little));
    sample.sz = Math.exp(readScalar(view, at + layout.scale2, tScale2, little));
    sample.qw = readScalar(view, at + layout.rot0, tRot0, little);
    sample.qx = readScalar(view, at + layout.rot1, tRot1, little);
    sample.qy = readScalar(view, at + layout.rot2, tRot2, little);
    sample.qz = readScalar(view, at + layout.rot3, tRot3, little);
    sample.sh1 = sh1Scratch;
    sample.sh2 = sh2Scratch;
    sample.sh3 = sh3Scratch;
    fillRest(view, at, layout, header, plan.shDegree, little, sh1Scratch, sh2Scratch, sh3Scratch);
    if (!acceptSample(accum)) continue;
    writeSample(kept, sample, plan, limits, packed, ext, sh1, sh2, sh3, sh3b);
    kept += 1;
  }
  return kept;
}

interface Sample {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  opacity: number;
  sx: number;
  sy: number;
  sz: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  sh1: Float32Array | null;
  sh2: Float32Array | null;
  sh3: Float32Array | null;
}

/** One splat record reused for the whole decode. Chunk awaits never overlap a fill. */
const sample: Sample = {
  x: 0,
  y: 0,
  z: 0,
  r: 0,
  g: 0,
  b: 0,
  opacity: 0,
  sx: 0,
  sy: 0,
  sz: 0,
  qx: 0,
  qy: 0,
  qz: 0,
  qw: 0,
  sh1: null,
  sh2: null,
  sh3: null,
};

interface DecodeAccum {
  originX: number;
  originY: number;
  originZ: number;
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  reservoir: Float32Array;
  seen: number;
  /** Next kept-center index that replaces a reservoir slot. Algorithm L. */
  reservoirNext: number;
  reservoirW: number;
  skippedNonFinite: number;
}

interface ChunkStats {
  sumX: number;
  sumY: number;
  sumZ: number;
  finite: number;
  sh1: Float32Array;
  sh2: Float32Array;
  sh3: Float32Array;
  n1: number;
  n2: number;
  n3: number;
}

function readFloats(
  floats: Float32Array,
  at: number,
  layout: PropLayout,
  nRest: number,
  sh: ShDegree,
  sh1: Float32Array | null,
  sh2: Float32Array | null,
  sh3: Float32Array | null,
): void {
  if (sh1 && nRest >= 3) fillRestFloats(floats, at + (layout.restBase >> 2), nRest, sh, sh1, sh2, sh3);
  sample.x = floats[at + (layout.x >> 2)] ?? 0;
  sample.y = floats[at + (layout.y >> 2)] ?? 0;
  sample.z = floats[at + (layout.z >> 2)] ?? 0;
  sample.r = 0.5 + SH_C0 * (floats[at + (layout.dc0 >> 2)] ?? 0);
  sample.g = 0.5 + SH_C0 * (floats[at + (layout.dc1 >> 2)] ?? 0);
  sample.b = 0.5 + SH_C0 * (floats[at + (layout.dc2 >> 2)] ?? 0);
  sample.opacity = sigmoid(floats[at + (layout.opacity >> 2)] ?? 0);
  sample.sx = Math.exp(floats[at + (layout.scale0 >> 2)] ?? 0);
  sample.sy = Math.exp(floats[at + (layout.scale1 >> 2)] ?? 0);
  sample.sz = Math.exp(floats[at + (layout.scale2 >> 2)] ?? 0);
  sample.qw = floats[at + (layout.rot0 >> 2)] ?? 0;
  sample.qx = floats[at + (layout.rot1 >> 2)] ?? 0;
  sample.qy = floats[at + (layout.rot2 >> 2)] ?? 0;
  sample.qz = floats[at + (layout.rot3 >> 2)] ?? 0;
  sample.sh1 = sh1;
  sample.sh2 = sh2;
  sample.sh3 = sh3;
}

/** Subtract the origin, drop non-finite centers, and keep min/max plus a reservoir. */
function acceptSample(accum: DecodeAccum): boolean {
  const x = sample.x - accum.originX;
  const y = sample.y - accum.originY;
  const z = sample.z - accum.originZ;
  if (!Number.isFinite(x + y + z)) {
    accum.skippedNonFinite += 1;
    return false;
  }
  sample.x = x;
  sample.y = y;
  sample.z = z;
  rememberCenter(accum, x, y, z);
  return true;
}

/** Min/max plus Vitter's Algorithm L. Replacements are O(k log n), not one random per splat. */
function rememberCenter(accum: DecodeAccum, x: number, y: number, z: number): void {
  if (x < accum.minX) accum.minX = x;
  if (y < accum.minY) accum.minY = y;
  if (z < accum.minZ) accum.minZ = z;
  if (x > accum.maxX) accum.maxX = x;
  if (y > accum.maxY) accum.maxY = y;
  if (z > accum.maxZ) accum.maxZ = z;
  const seen = accum.seen;
  if (seen < RESERVOIR) {
    const offset = seen * 3;
    accum.reservoir[offset] = x;
    accum.reservoir[offset + 1] = y;
    accum.reservoir[offset + 2] = z;
    const filled = seen + 1;
    accum.seen = filled;
    if (filled === RESERVOIR) {
      accum.reservoirW = Math.exp(Math.log(unitRandom()) / RESERVOIR);
      accum.reservoirNext = filled + reservoirSkip(accum.reservoirW);
    }
    return;
  }
  if (seen === accum.reservoirNext) {
    const slot = Math.floor(Math.random() * RESERVOIR) * 3;
    accum.reservoir[slot] = x;
    accum.reservoir[slot + 1] = y;
    accum.reservoir[slot + 2] = z;
    accum.reservoirW *= Math.exp(Math.log(unitRandom()) / RESERVOIR);
    accum.reservoirNext = seen + 1 + reservoirSkip(accum.reservoirW);
  }
  accum.seen = seen + 1;
}

function unitRandom(): number {
  const u = Math.random();
  return u === 0 ? Number.MIN_VALUE : u;
}

function reservoirSkip(w: number): number {
  const gap = Math.log(1 - w);
  if (!(gap < 0)) return Number.POSITIVE_INFINITY;
  const skip = Math.floor(Math.log(unitRandom()) / gap);
  return skip > 0 ? skip : 0;
}

function fillRestFloats(
  floats: Float32Array,
  restAt: number,
  nRest: number,
  sh: ShDegree,
  sh1: Float32Array,
  sh2: Float32Array | null,
  sh3: Float32Array | null,
): void {
  // INRIA stores f_rest channel-major: all R, then G, then B.
  copyRest(floats, restAt, nRest, 0, 3, sh1);
  if (sh >= 2 && sh2) copyRest(floats, restAt, nRest, 3, 5, sh2);
  if (sh >= 3 && sh3) copyRest(floats, restAt, nRest, 8, 7, sh3);
}

function copyRest(
  floats: Float32Array,
  restAt: number,
  nRest: number,
  from: number,
  coeffs: number,
  band: Float32Array,
): void {
  const g = restAt + nRest;
  const b = restAt + nRest * 2;
  for (let k = 0; k < coeffs; k += 1) {
    const coeff = k + from;
    band[k * 3] = floats[restAt + coeff]!;
    band[k * 3 + 1] = floats[g + coeff]!;
    band[k * 3 + 2] = floats[b + coeff]!;
  }
}

function fillRest(
  view: DataView,
  at: number,
  layout: PropLayout,
  header: GaussianPlyHeader,
  sh: ShDegree,
  little: boolean,
  sh1: Float32Array | null,
  sh2: Float32Array | null,
  sh3: Float32Array | null,
): void {
  if (!sh1 || header.nRest < 3 || layout.restBase < 0) return;
  const nRest = header.nRest;
  const read = (channel: number, coeff: number) =>
    readScalar(view, at + layout.restBase + (channel * nRest + coeff) * 4, 'float', little);
  for (let k = 0; k < 3; k += 1) {
    sh1[k * 3] = read(0, k);
    sh1[k * 3 + 1] = read(1, k);
    sh1[k * 3 + 2] = read(2, k);
  }
  if (sh >= 2 && sh2) {
    for (let k = 0; k < 5; k += 1) {
      sh2[k * 3] = read(0, 3 + k);
      sh2[k * 3 + 1] = read(1, 3 + k);
      sh2[k * 3 + 2] = read(2, 3 + k);
    }
  }
  if (sh >= 3 && sh3) {
    for (let k = 0; k < 7; k += 1) {
      sh3[k * 3] = read(0, 8 + k);
      sh3[k * 3 + 1] = read(1, 8 + k);
      sh3[k * 3 + 2] = read(2, 8 + k);
    }
  }
}

function writeSample(
  index: number,
  sample: Sample,
  plan: GaussianDecodePlan,
  limits: SplatEncodingLimits,
  packed: Uint32Array | undefined,
  ext: [Uint32Array, Uint32Array] | undefined,
  sh1: Uint32Array | undefined,
  sh2: Uint32Array | undefined,
  sh3: Uint32Array | undefined,
  sh3b: Uint32Array | undefined,
): void {
  if (plan.extended && ext) {
    writeExtSplat(
      ext[0],
      ext[1],
      index,
      sample.x,
      sample.y,
      sample.z,
      sample.sx,
      sample.sy,
      sample.sz,
      sample.qx,
      sample.qy,
      sample.qz,
      sample.qw,
      sample.opacity,
      sample.r,
      sample.g,
      sample.b,
    );
    if (plan.shDegree >= 2 && sh1 && sh2 && sample.sh1 && sample.sh2) {
      writeExtSh2(sh1, sh2, index, sample.sh1, sample.sh2);
    } else if (plan.shDegree >= 1 && sh1 && sample.sh1) {
      writeExtSh1(sh1, index, sample.sh1);
    }
    if (plan.shDegree >= 3 && sh3 && sh3b && sample.sh3) writeExtSh3(sh3, sh3b, index, sample.sh3);
    return;
  }
  if (!packed) return;
  writePackedSplat(
    packed,
    index,
    sample.x,
    sample.y,
    sample.z,
    sample.sx,
    sample.sy,
    sample.sz,
    sample.qx,
    sample.qy,
    sample.qz,
    sample.qw,
    sample.opacity,
    sample.r,
    sample.g,
    sample.b,
    limits,
  );
  if (plan.shDegree >= 1 && sh1 && sample.sh1) writePackedSh1(sh1, index, sample.sh1, limits.sh1Max);
  if (plan.shDegree >= 2 && sh2 && sample.sh2) writePackedSh2(sh2, index, sample.sh2, limits.sh2Max);
  if (plan.shDegree >= 3 && sh3 && sample.sh3) writePackedSh3(sh3, index, sample.sh3, limits.sh3Max);
}

function sigmoid(value: number): number {
  if (value >= 16) return 1;
  if (value <= -16) return 0;
  return 1 / (1 + Math.exp(-value));
}

function readScalar(view: DataView, offset: number, type: string, little: boolean): number {
  switch (type) {
    case 'float':
    case 'float32':
      return view.getFloat32(offset, little);
    case 'double':
    case 'float64':
      return view.getFloat64(offset, little);
    case 'uchar':
    case 'uint8':
      return view.getUint8(offset);
    case 'char':
    case 'int8':
      return view.getInt8(offset);
    case 'ushort':
    case 'uint16':
      return view.getUint16(offset, little);
    case 'short':
    case 'int16':
      return view.getInt16(offset, little);
    case 'uint':
    case 'uint32':
      return view.getUint32(offset, little);
    case 'int':
    case 'int32':
      return view.getInt32(offset, little);
    default:
      return 0;
  }
}

function parseVertex(header: string): { count: number; props: Prop[]; bytes: number } | null {
  let current: { name: string; count: number; props: Prop[]; bytes: number } | null = null;
  let vertex: { count: number; props: Prop[]; bytes: number } | null = null;
  for (const raw of header.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('comment') || line.startsWith('obj_info')) continue;
    if (line.startsWith('element ')) {
      if (current?.name === 'vertex') vertex = { count: current.count, props: current.props, bytes: current.bytes };
      const parts = line.split(/\s+/);
      current = { name: parts[1] ?? '', count: Number(parts[2] ?? 0), props: [], bytes: 0 };
      continue;
    }
    if (line.startsWith('property ') && current) {
      const parts = line.split(/\s+/);
      if (parts[1] === 'list') {
        throw new GaussianPlyUnsupported('List properties on gaussian vertices are not supported.');
      }
      const type = (parts[1] ?? '').toLowerCase();
      const size = TYPE_SIZE[type];
      if (!size) throw new GaussianPlyError(`Unsupported PLY property type "${type}".`);
      current.props.push({ name: parts[2] ?? '', type, size, offset: current.bytes });
      current.bytes += size;
    }
  }
  if (current?.name === 'vertex') vertex = { count: current.count, props: current.props, bytes: current.bytes };
  return vertex;
}

function layoutOf(props: Prop[]): PropLayout | null {
  const byName = new Map(props.map((prop) => [prop.name, prop]));
  const need = [
    'x',
    'y',
    'z',
    'f_dc_0',
    'f_dc_1',
    'f_dc_2',
    'opacity',
    'scale_0',
    'scale_1',
    'scale_2',
    'rot_0',
    'rot_1',
    'rot_2',
    'rot_3',
  ];
  if (need.some((name) => !byName.has(name))) return null;
  const at = (name: string) => byName.get(name)!.offset;
  const rest = byName.get('f_rest_0');
  const types: Record<string, string> = {};
  for (const prop of props) types[prop.name] = prop.type;
  return {
    x: at('x'),
    y: at('y'),
    z: at('z'),
    dc0: at('f_dc_0'),
    dc1: at('f_dc_1'),
    dc2: at('f_dc_2'),
    opacity: at('opacity'),
    scale0: at('scale_0'),
    scale1: at('scale_1'),
    scale2: at('scale_2'),
    rot0: at('rot_0'),
    rot1: at('rot_1'),
    rot2: at('rot_2'),
    rot3: at('rot_3'),
    restBase: rest ? rest.offset : -1,
    types,
  };
}

function shLayout(props: Prop[]): { degree: ShDegree; nRest: number } {
  let rest = 0;
  const names = new Set(props.map((prop) => prop.name));
  while (names.has(`f_rest_${rest}`)) rest += 1;
  if (rest === 0) return { degree: 0, nRest: 0 };
  if (rest % 3 !== 0) {
    throw new GaussianPlyUnsupported(`f_rest count ${rest} is not divisible by 3.`);
  }
  const nRest = rest / 3;
  const coeffs = nRest + 1;
  const bands = Math.round(Math.sqrt(coeffs));
  if (bands * bands !== coeffs) {
    throw new GaussianPlyUnsupported(`f_rest does not form a complete SH degree (${rest} floats).`);
  }
  return { degree: Math.min(3, bands - 1) as ShDegree, nRest };
}

function parseGeoref(header: string): GaussianGeoref {
  const geo: GaussianGeoref = {};
  for (const raw of header.split(/\r?\n/)) {
    const match = /^comment\s+([A-Za-z0-9_]+)\s+(\S+)/i.exec(raw.trim());
    if (!match) continue;
    const key = (match[1] ?? '').toLowerCase().replace(/_/g, '');
    const value = match[2] ?? '';
    if (key === 'offsetx') geo.offsetX = value;
    else if (key === 'offsety') geo.offsetY = value;
    else if (key === 'offsetz') geo.offsetZ = value;
    else if (key === 'epsg') geo.epsg = value;
    else if (key === 'minx') geo.minX = value;
    else if (key === 'miny') geo.minY = value;
    else if (key === 'minz') geo.minZ = value;
    else if (key === 'maxx') geo.maxX = value;
    else if (key === 'maxy') geo.maxY = value;
    else if (key === 'maxz') geo.maxZ = value;
  }
  return geo;
}

function scanChunk(buf: ArrayBuffer, header: GaussianPlyHeader): ChunkStats {
  const verts = Math.floor(buf.byteLength / header.stride);
  const stats: ChunkStats = {
    sumX: 0,
    sumY: 0,
    sumZ: 0,
    finite: 0,
    sh1: new Float32Array(verts * 9),
    sh2: new Float32Array(verts * 15),
    sh3: new Float32Array(verts * 21),
    n1: 0,
    n2: 0,
    n3: 0,
  };
  if (verts <= 0) return stats;
  if (header.fast) scanFast(new Float32Array(buf), verts, header, stats);
  else scanView(new DataView(buf), verts, header, stats);
  return stats;
}

function scanFast(floats: Float32Array, verts: number, header: GaussianPlyHeader, stats: ChunkStats): void {
  const words = header.stride / 4;
  const layout = header.layout;
  const restAtWord = layout.restBase / 4;
  const nRest = header.nRest;
  const collect = nRest >= 3 && layout.restBase >= 0;
  for (let i = 0; i < verts; i += 1) {
    const at = i * words;
    const x = floats[at + layout.x / 4] ?? 0;
    const y = floats[at + layout.y / 4] ?? 0;
    const z = floats[at + layout.z / 4] ?? 0;
    if (Number.isFinite(x + y + z)) {
      stats.sumX += x;
      stats.sumY += y;
      stats.sumZ += z;
      stats.finite += 1;
    }
    if (!collect) continue;
    const restAt = at + restAtWord;
    stats.n1 = pushBandFloats(floats, restAt, nRest, 0, 3, stats.sh1, stats.n1);
    if (nRest >= 8) stats.n2 = pushBandFloats(floats, restAt, nRest, 3, 5, stats.sh2, stats.n2);
    if (nRest >= 15) stats.n3 = pushBandFloats(floats, restAt, nRest, 8, 7, stats.sh3, stats.n3);
  }
}

function scanView(view: DataView, verts: number, header: GaussianPlyHeader, stats: ChunkStats): void {
  const layout = header.layout;
  const little = header.little;
  const tx = layout.types.x ?? 'float';
  const ty = layout.types.y ?? 'float';
  const tz = layout.types.z ?? 'float';
  const nRest = header.nRest;
  const collect = nRest >= 3 && layout.restBase >= 0;
  for (let i = 0; i < verts; i += 1) {
    const at = i * header.stride;
    const x = readScalar(view, at + layout.x, tx, little);
    const y = readScalar(view, at + layout.y, ty, little);
    const z = readScalar(view, at + layout.z, tz, little);
    if (Number.isFinite(x + y + z)) {
      stats.sumX += x;
      stats.sumY += y;
      stats.sumZ += z;
      stats.finite += 1;
    }
    if (!collect) continue;
    stats.n1 = pushBandView(view, at, layout.restBase, nRest, 0, 3, little, stats.sh1, stats.n1);
    if (nRest >= 8) stats.n2 = pushBandView(view, at, layout.restBase, nRest, 3, 5, little, stats.sh2, stats.n2);
    if (nRest >= 15) stats.n3 = pushBandView(view, at, layout.restBase, nRest, 8, 7, little, stats.sh3, stats.n3);
  }
}

function pushBandFloats(
  floats: Float32Array,
  restAt: number,
  nRest: number,
  from: number,
  count: number,
  bucket: Float32Array,
  offset: number,
): number {
  const g = restAt + nRest;
  const b = restAt + nRest * 2;
  let n = offset;
  for (let k = 0; k < count; k += 1) {
    const coeff = from + k;
    n = pushAbs(bucket, n, floats[restAt + coeff] ?? 0);
    n = pushAbs(bucket, n, floats[g + coeff] ?? 0);
    n = pushAbs(bucket, n, floats[b + coeff] ?? 0);
  }
  return n;
}

function pushBandView(
  view: DataView,
  at: number,
  restBase: number,
  nRest: number,
  from: number,
  count: number,
  little: boolean,
  bucket: Float32Array,
  offset: number,
): number {
  let n = offset;
  for (let k = 0; k < count; k += 1) {
    const coeff = from + k;
    n = pushAbs(bucket, n, readScalar(view, at + restBase + coeff * 4, 'float', little));
    n = pushAbs(bucket, n, readScalar(view, at + restBase + (nRest + coeff) * 4, 'float', little));
    n = pushAbs(bucket, n, readScalar(view, at + restBase + (nRest * 2 + coeff) * 4, 'float', little));
  }
  return n;
}

function pushAbs(bucket: Float32Array, offset: number, value: number): number {
  if (!Number.isFinite(value)) return offset;
  bucket[offset] = Math.abs(value);
  return offset + 1;
}

function limitsFrom(stats: ChunkStats): SplatEncodingLimits {
  return {
    ...DEFAULT_LIMITS,
    sh1Max: bandLimit(stats.sh1, stats.n1, DEFAULT_LIMITS.sh1Max),
    sh2Max: bandLimit(stats.sh2, stats.n2, DEFAULT_LIMITS.sh2Max),
    sh3Max: bandLimit(stats.sh3, stats.n3, DEFAULT_LIMITS.sh3Max),
  };
}

function bandLimit(samples: Float32Array, count: number, fallback: number): number {
  if (count <= 0) return fallback;
  const filled = samples.subarray(0, count);
  filled.sort();
  const index = Math.min(count - 1, Math.max(0, Math.round(0.99 * (count - 1))));
  return Math.min(4, Math.max(0.25, filled[index] ?? 0));
}

function midpoint(minText: string | undefined, maxText: string | undefined): number | undefined {
  if (minText === undefined || maxText === undefined) return undefined;
  const min = Number(minText);
  const max = Number(maxText);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  return (min + max) / 2;
}

function axisBounds(accum: DecodeAccum): GaussianBounds {
  if (accum.seen <= 0 || !Number.isFinite(accum.minX)) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }
  return {
    min: [accum.minX, accum.minY, accum.minZ],
    max: [accum.maxX, accum.maxY, accum.maxZ],
  };
}

function robustBounds(accum: DecodeAccum): GaussianBounds {
  const n = Math.min(accum.seen, RESERVOIR);
  if (n <= 0) return { min: [0, 0, 0], max: [0, 0, 0] };
  const xs = axisCopy(accum.reservoir, n, 0);
  const ys = axisCopy(accum.reservoir, n, 1);
  const zs = axisCopy(accum.reservoir, n, 2);
  return {
    min: [percentile(xs, 0.005), percentile(ys, 0.005), percentile(zs, 0.005)],
    max: [percentile(xs, 0.995), percentile(ys, 0.995), percentile(zs, 0.995)],
  };
}

function axisCopy(sampleCenters: Float32Array, n: number, axis: number): Float32Array {
  const copy = new Float32Array(n);
  for (let i = 0; i < n; i += 1) copy[i] = sampleCenters[i * 3 + axis] ?? 0;
  copy.sort();
  return copy;
}

function percentile(sorted: Float32Array, p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const index = Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))));
  return sorted[index] ?? 0;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error && reason.name !== 'AbortError') throw reason;
  throw new DOMException('Load aborted', 'AbortError');
}

function formatMiB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024)).toLocaleString()} MB`;
}
