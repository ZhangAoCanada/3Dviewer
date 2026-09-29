export interface PointCloudData {
  positions: Float32Array;
  colors: Float32Array | null;
  count: number;
  sourceCount: number;
  stride: number;
}

export class PlyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlyParseError';
  }
}

interface Prop {
  name: string;
  type: string;
  size: number;
  offset: number;
}

interface ElementDef {
  name: string;
  count: number;
  props: Prop[];
  bytes: number;
  hasList: boolean;
}

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

const CHUNK = 4 * 1024 * 1024;

/**
 * Stream a PLY point cloud from a Blob. Binary files are read in chunks and
 * subsampled to `maxPoints`, so a multi-hundred-MB cloud does not have to
 * become a single JS array of every vertex.
 */
export async function parsePlyPoints(blob: Blob, maxPoints: number): Promise<PointCloudData> {
  const header = await readHeader(blob);
  const elements = parseElements(header.text);
  const vertex = elements.find((el) => el.name === 'vertex');
  if (!vertex) throw new PlyParseError('PLY has no vertex element');
  if (vertex.hasList) throw new PlyParseError('List properties on vertices are not supported');
  const x = vertex.props.find((p) => p.name === 'x');
  const y = vertex.props.find((p) => p.name === 'y');
  const z = vertex.props.find((p) => p.name === 'z');
  if (!x || !y || !z) throw new PlyParseError('PLY vertex is missing x/y/z');

  const colorProps = findColorProps(vertex.props);
  const cap = Math.max(1, Math.floor(maxPoints));
  const stride = Math.max(1, Math.ceil(vertex.count / cap));
  const samples = Math.ceil(vertex.count / stride);
  const positions = new Float32Array(samples * 3);
  const colors = colorProps ? new Float32Array(samples * 3) : null;

  let preBytes = 0;
  for (const el of elements) {
    if (el.name === 'vertex') break;
    if (el.hasList) {
      throw new PlyParseError('PLY list properties before the vertex element are not supported');
    }
    preBytes += el.count * el.bytes;
  }

  if (header.format === 'ascii') {
    await readAscii(blob, header.byteLength, vertex, colorProps, stride, positions, colors);
  } else {
    const little = header.format === 'binary_little_endian';
    await readBinary(
      blob,
      header.byteLength + preBytes,
      vertex,
      x,
      y,
      z,
      colorProps,
      stride,
      little,
      positions,
      colors,
    );
  }

  return {
    positions,
    colors,
    count: samples,
    sourceCount: vertex.count,
    stride,
  };
}

function findColorProps(props: Prop[]): [Prop, Prop, Prop] | null {
  const names = [
    ['red', 'green', 'blue'],
    ['r', 'g', 'b'],
    ['diffuse_red', 'diffuse_green', 'diffuse_blue'],
  ];
  for (const [r, g, b] of names) {
    const pr = props.find((p) => p.name === r);
    const pg = props.find((p) => p.name === g);
    const pb = props.find((p) => p.name === b);
    if (pr && pg && pb) return [pr, pg, pb];
  }
  return null;
}

interface HeaderInfo {
  text: string;
  byteLength: number;
  format: 'ascii' | 'binary_little_endian' | 'binary_big_endian';
}

async function readHeader(blob: Blob): Promise<HeaderInfo> {
  const cap = Math.min(blob.size, 1024 * 1024);
  const bytes = new Uint8Array(await blob.slice(0, cap).arrayBuffer());
  const text = new TextDecoder('latin1').decode(bytes);
  const marker = 'end_header';
  const idx = text.indexOf(marker);
  if (idx < 0) throw new PlyParseError('PLY header is missing end_header');
  let byteLength = idx + marker.length;
  if (text.charCodeAt(byteLength) === 13) byteLength += 1;
  if (text.charCodeAt(byteLength) === 10) byteLength += 1;
  const formatLine = text.match(/format\s+(\S+)/i);
  const format = formatLine?.[1]?.toLowerCase();
  if (format !== 'ascii' && format !== 'binary_little_endian' && format !== 'binary_big_endian') {
    throw new PlyParseError(`Unsupported PLY format${format ? `: ${format}` : ''}`);
  }
  return { text: text.slice(0, idx + marker.length), byteLength, format };
}

function parseElements(header: string): ElementDef[] {
  const elements: ElementDef[] = [];
  let current: ElementDef | null = null;
  for (const raw of header.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('comment') || line.startsWith('obj_info')) continue;
    if (line.startsWith('element ')) {
      const parts = line.split(/\s+/);
      current = { name: parts[1] ?? '', count: Number(parts[2] ?? 0), props: [], bytes: 0, hasList: false };
      elements.push(current);
      continue;
    }
    if (line.startsWith('property ') && current) {
      const parts = line.split(/\s+/);
      if (parts[1] === 'list') {
        current.hasList = true;
        continue;
      }
      const type = (parts[1] ?? '').toLowerCase();
      const size = TYPE_SIZE[type];
      if (!size) throw new PlyParseError(`Unsupported PLY property type "${type}"`);
      const prop: Prop = { name: parts[2] ?? '', type, size, offset: current.bytes };
      current.props.push(prop);
      current.bytes += size;
    }
  }
  return elements;
}

function colorValue(value: number, type: string): number {
  if (type === 'float' || type === 'float32' || type === 'double' || type === 'float64') {
    return value > 1 ? value / 255 : value;
  }
  return value / 255;
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
    case 'short':
    case 'int16':
      return view.getInt16(offset, little);
    case 'ushort':
    case 'uint16':
      return view.getUint16(offset, little);
    case 'int':
    case 'int32':
      return view.getInt32(offset, little);
    case 'uint':
    case 'uint32':
      return view.getUint32(offset, little);
    default:
      return 0;
  }
}

async function readBinary(
  blob: Blob,
  bodyStart: number,
  vertex: ElementDef,
  x: Prop,
  y: Prop,
  z: Prop,
  colorProps: [Prop, Prop, Prop] | null,
  stride: number,
  little: boolean,
  positions: Float32Array,
  colors: Float32Array | null,
): Promise<void> {
  const strideBytes = vertex.bytes;
  const bodyBytes = vertex.count * strideBytes;
  if (bodyStart + bodyBytes > blob.size + 1) {
    throw new PlyParseError('PLY vertex data is truncated');
  }
  let filePos = bodyStart;
  const end = bodyStart + bodyBytes;
  let out = 0;
  while (filePos < end) {
    const remaining = end - filePos;
    const want = Math.min(CHUNK - (CHUNK % strideBytes || 0), remaining);
    const take = want < strideBytes ? strideBytes : want - (want % strideBytes);
    const buf = await blob.slice(filePos, filePos + take).arrayBuffer();
    const view = new DataView(buf);
    const verts = Math.floor(view.byteLength / strideBytes);
    const baseIndex = (filePos - bodyStart) / strideBytes;
    for (let i = 0; i < verts; i++) {
      const index = baseIndex + i;
      if (index % stride !== 0) continue;
      const at = i * strideBytes;
      const o = out * 3;
      positions[o] = readScalar(view, at + x.offset, x.type, little);
      positions[o + 1] = readScalar(view, at + y.offset, y.type, little);
      positions[o + 2] = readScalar(view, at + z.offset, z.type, little);
      if (colors && colorProps) {
        colors[o] = colorValue(readScalar(view, at + colorProps[0].offset, colorProps[0].type, little), colorProps[0].type);
        colors[o + 1] = colorValue(readScalar(view, at + colorProps[1].offset, colorProps[1].type, little), colorProps[1].type);
        colors[o + 2] = colorValue(readScalar(view, at + colorProps[2].offset, colorProps[2].type, little), colorProps[2].type);
      }
      out += 1;
    }
    filePos += verts * strideBytes;
    if (verts === 0) break;
  }
}

async function readAscii(
  blob: Blob,
  bodyStart: number,
  vertex: ElementDef,
  colorProps: [Prop, Prop, Prop] | null,
  stride: number,
  positions: Float32Array,
  colors: Float32Array | null,
): Promise<void> {
  const col = new Map(vertex.props.map((prop, index) => [prop.name, index]));
  const xi = col.get('x');
  const yi = col.get('y');
  const zi = col.get('z');
  if (xi === undefined || yi === undefined || zi === undefined) {
    throw new PlyParseError('PLY vertex is missing x/y/z');
  }
  const cr = colorProps ? col.get(colorProps[0].name) : undefined;
  const cg = colorProps ? col.get(colorProps[1].name) : undefined;
  const cb = colorProps ? col.get(colorProps[2].name) : undefined;
  let pos = bodyStart;
  let carry = '';
  let index = 0;
  let out = 0;
  const decoder = new TextDecoder('latin1');
  while (pos < blob.size && index < vertex.count) {
    const buf = await blob.slice(pos, Math.min(blob.size, pos + CHUNK)).arrayBuffer();
    pos += buf.byteLength;
    const text = carry + decoder.decode(buf, { stream: pos < blob.size });
    const lines = text.split(/\r?\n/);
    carry = pos < blob.size ? (lines.pop() ?? '') : '';
    for (const line of lines) {
      if (index >= vertex.count) break;
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (index % stride === 0) {
        const parts = trimmed.split(/\s+/);
        const o = out * 3;
        positions[o] = Number(parts[xi]);
        positions[o + 1] = Number(parts[yi]);
        positions[o + 2] = Number(parts[zi]);
        if (colors && cr !== undefined && cg !== undefined && cb !== undefined && colorProps) {
          colors[o] = colorValue(Number(parts[cr]), colorProps[0].type);
          colors[o + 1] = colorValue(Number(parts[cg]), colorProps[1].type);
          colors[o + 2] = colorValue(Number(parts[cb]), colorProps[2].type);
        }
        out += 1;
      }
      index += 1;
    }
  }
  if (carry.trim() && index < vertex.count && index % stride === 0) {
    const parts = carry.trim().split(/\s+/);
    const o = out * 3;
    positions[o] = Number(parts[xi]);
    positions[o + 1] = Number(parts[yi]);
    positions[o + 2] = Number(parts[zi]);
  }
}

export function colorizeByHeight(positions: Float32Array): Float32Array {
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < positions.length; i += 3) {
    const y = positions[i] ?? 0;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = Math.max(maxY - minY, 1e-6);
  const colors = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const t = ((positions[i + 1] ?? 0) - minY) / span;
    colors[i] = 0.22 + 0.72 * t;
    colors[i + 1] = 0.62 - 0.18 * t;
    colors[i + 2] = 0.78 - 0.42 * t;
  }
  return colors;
}
