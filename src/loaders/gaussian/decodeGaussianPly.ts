import type { MemoryBudget } from '../../core/types';
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

export interface DecodeGaussianOptions {
  budget: MemoryBudget;
  /** Float32 centers when the budget can hold them. */
  preferExtended: boolean;
  chunkBytes?: number;
  signal?: AbortSignal;
  onProgress?: (progress: DecodeProgress) => void;
  limits?: SplatEncodingLimits;
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
}

export async function inspectGaussianPly(blob: Blob): Promise<GaussianPlyHeader | null> {
  try {
    return await readGaussianPlyHeader(blob);
  } catch (error) {
    if (error instanceof GaussianPlyUnsupported) return null;
    throw error;
  }
}

export async function readGaussianPlyHeader(blob: Blob): Promise<GaussianPlyHeader> {
  const cap = Math.min(blob.size, HEADER_PROBE);
  const bytes = new Uint8Array(await blob.slice(0, cap).arrayBuffer());
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

export async function decodeGaussianPly(blob: Blob, options: DecodeGaussianOptions): Promise<DecodedGaussian> {
  const header = await readGaussianPlyHeader(blob);
  throwIfAborted(options.signal);
  const resolved = resolveVertexCount(header.headerCount, header.byteLength, blob.size, header.stride);
  const plan = planGaussianDecode({
    sourceCount: resolved.count,
    sourceSh: header.sourceSh,
    budget: options.budget,
    preferExtended: options.preferExtended,
  });
  if (plan.decodedCount <= 0) {
    throw new GaussianPlyError('Gaussian PLY contains no splats.');
  }

  const limits = options.limits ?? DEFAULT_LIMITS;
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

  while (filePos < end) {
    throwIfAborted(options.signal);
    const remaining = end - filePos;
    const take = Math.min(aligned, remaining);
    const buf = await blob.slice(filePos, filePos + take).arrayBuffer();
    const base = (filePos - header.byteLength) / header.stride;
    const verts = Math.floor(buf.byteLength / header.stride);
    if (verts <= 0) break;
    if (header.fast) {
      kept = consumeFloats(
        new Float32Array(buf),
        verts,
        base,
        header,
        plan,
        limits,
        kept,
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
    filePos += verts * header.stride;
    report(Math.min(resolved.count, base + verts));
  }
  report(resolved.count, true);

  const notes = [...plan.notes];
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
  };
}

function consumeFloats(
  floats: Float32Array,
  verts: number,
  base: number,
  header: GaussianPlyHeader,
  plan: GaussianDecodePlan,
  limits: SplatEncodingLimits,
  kept: number,
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
  const stride = header.stride / 4;
  const layout = header.layout;
  const step = plan.stride;
  for (let i = 0; i < verts; i += 1) {
    const index = base + i;
    if (step > 1 && index % step !== 0) continue;
    const at = i * stride;
    const sample = readFloats(floats, at, layout, header.nRest, plan.shDegree, sh1Scratch, sh2Scratch, sh3Scratch);
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
  for (let i = 0; i < verts; i += 1) {
    const index = base + i;
    if (step > 1 && index % step !== 0) continue;
    const at = i * header.stride;
    const read = (offset: number, name: string) => readScalar(view, at + offset, layout.types[name] ?? 'float', little);
    const x = read(layout.x, 'x');
    const y = read(layout.y, 'y');
    const z = read(layout.z, 'z');
    const r = 0.5 + SH_C0 * read(layout.dc0, 'f_dc_0');
    const g = 0.5 + SH_C0 * read(layout.dc1, 'f_dc_1');
    const b = 0.5 + SH_C0 * read(layout.dc2, 'f_dc_2');
    const opacity = sigmoid(read(layout.opacity, 'opacity'));
    const sx = Math.exp(read(layout.scale0, 'scale_0'));
    const sy = Math.exp(read(layout.scale1, 'scale_1'));
    const sz = Math.exp(read(layout.scale2, 'scale_2'));
    const qw = read(layout.rot0, 'rot_0');
    const qx = read(layout.rot1, 'rot_1');
    const qy = read(layout.rot2, 'rot_2');
    const qz = read(layout.rot3, 'rot_3');
    fillRest(view, at, layout, header, plan.shDegree, little, sh1Scratch, sh2Scratch, sh3Scratch);
    writeSample(
      kept,
      { x, y, z, r, g, b, opacity, sx, sy, sz, qx, qy, qz, qw, sh1: sh1Scratch, sh2: sh2Scratch, sh3: sh3Scratch },
      plan,
      limits,
      packed,
      ext,
      sh1,
      sh2,
      sh3,
      sh3b,
    );
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

function readFloats(
  floats: Float32Array,
  at: number,
  layout: PropLayout,
  nRest: number,
  sh: ShDegree,
  sh1: Float32Array | null,
  sh2: Float32Array | null,
  sh3: Float32Array | null,
): Sample {
  const f = (word: number) => floats[at + word] ?? 0;
  if (sh1 && nRest >= 3) fillRestFloats(floats, at + layout.restBase / 4, nRest, sh, sh1, sh2, sh3);
  return {
    x: f(layout.x / 4),
    y: f(layout.y / 4),
    z: f(layout.z / 4),
    r: 0.5 + SH_C0 * f(layout.dc0 / 4),
    g: 0.5 + SH_C0 * f(layout.dc1 / 4),
    b: 0.5 + SH_C0 * f(layout.dc2 / 4),
    opacity: sigmoid(f(layout.opacity / 4)),
    sx: Math.exp(f(layout.scale0 / 4)),
    sy: Math.exp(f(layout.scale1 / 4)),
    sz: Math.exp(f(layout.scale2 / 4)),
    qw: f(layout.rot0 / 4),
    qx: f(layout.rot1 / 4),
    qy: f(layout.rot2 / 4),
    qz: f(layout.rot3 / 4),
    sh1,
    sh2,
    sh3,
  };
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
    band[k * 3] = floats[restAt + coeff] ?? 0;
    band[k * 3 + 1] = floats[g + coeff] ?? 0;
    band[k * 3 + 2] = floats[b + coeff] ?? 0;
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error && reason.name !== 'AbortError') throw reason;
  throw new DOMException('Load aborted', 'AbortError');
}

function formatMiB(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024)).toLocaleString()} MB`;
}
