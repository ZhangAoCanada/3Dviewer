import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const samples = join(root, 'public', 'samples');
mkdirSync(samples, { recursive: true });

const SH_C0 = 0.28209479177387814;

function hsv(h, s, v) {
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

function writeGaussian() {
  const major = 1.15;
  const minor = 0.38;
  const rings = 100;
  const tube = 48;
  const count = rings * tube;
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${count}`,
    'property float x',
    'property float y',
    'property float z',
    'property float nx',
    'property float ny',
    'property float nz',
    'property float f_dc_0',
    'property float f_dc_1',
    'property float f_dc_2',
    'property float opacity',
    'property float scale_0',
    'property float scale_1',
    'property float scale_2',
    'property float rot_0',
    'property float rot_1',
    'property float rot_2',
    'property float rot_3',
    'end_header\n',
  ].join('\n');
  const body = Buffer.alloc(count * 17 * 4);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const splat = Buffer.alloc(count * 32);
  const splatView = new DataView(splat.buffer, splat.byteOffset, splat.byteLength);
  let o = 0;
  let s = 0;
  for (let i = 0; i < rings; i++) {
    const theta = (i / rings) * Math.PI * 2;
    for (let j = 0; j < tube; j++) {
      const phi = (j / tube) * Math.PI * 2;
      const cx = Math.cos(theta) * major;
      const cz = Math.sin(theta) * major;
      const radialX = Math.cos(theta);
      const radialZ = Math.sin(theta);
      const x = cx + radialX * Math.cos(phi) * minor;
      const y = Math.sin(phi) * minor;
      const z = cz + radialZ * Math.cos(phi) * minor;
      const [r, g, b] = hsv(i / rings, 0.55, 0.92);
      const opacity = Math.log(0.9 / 0.1);
      const spacing = (2 * Math.PI * minor) / tube;
      const scale = Math.log(spacing * 1.35);
      const values = [x, y, z, 0, 1, 0, (r - 0.5) / SH_C0, (g - 0.5) / SH_C0, (b - 0.5) / SH_C0, opacity, scale, scale, scale, 1, 0, 0, 0];
      for (const value of values) {
        view.setFloat32(o, value, true);
        o += 4;
      }
      const linear = Math.exp(scale);
      splatView.setFloat32(s, x, true);
      splatView.setFloat32(s + 4, y, true);
      splatView.setFloat32(s + 8, z, true);
      splatView.setFloat32(s + 12, linear, true);
      splatView.setFloat32(s + 16, linear, true);
      splatView.setFloat32(s + 20, linear, true);
      splat[s + 24] = Math.round(r * 255);
      splat[s + 25] = Math.round(g * 255);
      splat[s + 26] = Math.round(b * 255);
      splat[s + 27] = 217;
      splat[s + 28] = 128;
      splat[s + 29] = 128;
      splat[s + 30] = 128;
      splat[s + 31] = 255;
      s += 32;
    }
  }
  writeFileSync(join(samples, 'torus.ply'), Buffer.concat([Buffer.from(header), body]));
  writeFileSync(join(samples, 'torus.splat'), splat);
  return count;
}

function writeCloud() {
  const count = 24000;
  const header = [
    'ply',
    'format binary_little_endian 1.0',
    `element vertex ${count}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    'end_header\n',
  ].join('\n');
  const body = Buffer.alloc(count * 15);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let o = 0;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const turns = t * Math.PI * 10;
    const radius = 0.15 + t * 1.35;
    const x = Math.cos(turns) * radius;
    const z = Math.sin(turns) * radius * 0.72;
    const y = Math.sin(turns * 2) * 0.28 + (t - 0.5) * 0.4;
    const [r, g, b] = hsv(t, 0.7, 0.95);
    view.setFloat32(o, x, true);
    view.setFloat32(o + 4, y, true);
    view.setFloat32(o + 8, z, true);
    body[o + 12] = Math.round(r * 255);
    body[o + 13] = Math.round(g * 255);
    body[o + 14] = Math.round(b * 255);
    o += 15;
  }
  writeFileSync(join(samples, 'cloud.ply'), Buffer.concat([Buffer.from(header), body]));
  return count;
}

function writeSphere() {
  const latBands = 24;
  const lonBands = 32;
  const lines = ['# generated sphere'];
  const verts = [];
  const normals = [];
  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat * Math.PI) / latBands;
    const y = Math.cos(theta);
    const ring = Math.sin(theta);
    for (let lon = 0; lon <= lonBands; lon++) {
      const phi = (lon * 2 * Math.PI) / lonBands;
      const x = ring * Math.cos(phi) * 0.85;
      const z = ring * Math.sin(phi) * 0.85;
      verts.push([x, y * 0.85, z]);
      normals.push([x, y * 0.85, z]);
    }
  }
  for (const [x, y, z] of verts) lines.push(`v ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}`);
  for (const [x, y, z] of normals) lines.push(`vn ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}`);
  const stride = lonBands + 1;
  for (let lat = 0; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const a = lat * stride + lon + 1;
      const b = a + stride;
      lines.push(`f ${a}//${a} ${a + 1}//${a + 1} ${b}//${b}`);
      lines.push(`f ${a + 1}//${a + 1} ${b + 1}//${b + 1} ${b}//${b}`);
    }
  }
  writeFileSync(join(samples, 'sphere.obj'), `${lines.join('\n')}\n`);
}

function accessor(bufferViews, buffers, array, type, component, target) {
  const bytes = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
  const pad = (4 - (bytes.length % 4)) % 4;
  const padded = Buffer.concat([bytes, Buffer.alloc(pad)]);
  const offset = buffers.length ? buffers[buffers.length - 1].end : 0;
  const viewIndex = bufferViews.length;
  bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
  const min = [];
  const max = [];
  const width = component === 'SCALAR' ? 1 : 3;
  for (let c = 0; c < width; c++) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = c; i < array.length; i += width) {
      lo = Math.min(lo, array[i]);
      hi = Math.max(hi, array[i]);
    }
    min.push(lo);
    max.push(hi);
  }
  buffers.push({ bytes: padded, end: offset + padded.length });
  return {
    bufferView: viewIndex,
    componentType: type,
    count: array.length / width,
    type: component,
    min,
    max,
  };
}

function writeCrate() {
  const positions = [];
  const normals = [];
  const colors = [];
  const indices = [];
  const faces = [
    { n: [0, 0, 1], c: [0.9, 0.42, 0.38], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { n: [0, 0, -1], c: [0.36, 0.62, 0.95], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
    { n: [0, 1, 0], c: [0.45, 0.82, 0.62], v: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
    { n: [0, -1, 0], c: [0.95, 0.78, 0.38], v: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
    { n: [1, 0, 0], c: [0.72, 0.5, 0.95], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
    { n: [-1, 0, 0], c: [0.95, 0.55, 0.72], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
  ];
  for (const face of faces) {
    const base = positions.length / 3;
    for (const vert of face.v) {
      positions.push(vert[0] * 0.55, vert[1] * 0.55, vert[2] * 0.55);
      normals.push(...face.n);
      colors.push(...face.c);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const views = [];
  const chunks = [];
  const accessors = [
    accessor(views, chunks, Float32Array.from(positions), 5126, 'VEC3', 34962),
    accessor(views, chunks, Float32Array.from(normals), 5126, 'VEC3', 34962),
    accessor(views, chunks, Float32Array.from(colors), 5126, 'VEC3', 34962),
    accessor(views, chunks, Uint16Array.from(indices), 5123, 'SCALAR', 34963),
  ];
  const bin = Buffer.concat(chunks.map((chunk) => chunk.bytes));
  const json = {
    asset: { version: '2.0', generator: '3dviewer-samples' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'crate' }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: {
          baseColorFactor: [1, 1, 1, 1],
          metallicFactor: 0.04,
          roughnessFactor: 0.55,
        },
      },
    ],
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: bin.length }],
  };
  const jsonBuf = Buffer.from(JSON.stringify(json));
  const jsonPad = (4 - (jsonBuf.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBuf, Buffer.alloc(jsonPad, 0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(total, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonChunk.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binChunk.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  writeFileSync(join(samples, 'crate.glb'), Buffer.concat([header, jh, jsonChunk, bh, binChunk]));
}

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const name = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
  return Buffer.concat([length, name, data, crc]);
}

function writeIcon(size, file) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (x + 0.5 - cx) / size;
      const dy = (y + 0.5 - cy) / size;
      const card = Math.max(Math.abs(dx), Math.abs(dy));
      const bg = card < 0.42 ? [18, 22, 30, 255] : [12, 15, 20, 0];
      rgba[i] = bg[0];
      rgba[i + 1] = bg[1];
      rgba[i + 2] = bg[2];
      rgba[i + 3] = bg[3];
      const r = Math.hypot(dx + 0.02, dy + 0.02) / 0.22;
      if (r < 1) {
        rgba[i] = Math.round(126 + 40 * (1 - r));
        rgba[i + 1] = Math.round(224 - 30 * r);
        rgba[i + 2] = Math.round(198 + 20 * r);
        rgba[i + 3] = 255;
      }
      const r2 = Math.hypot(dx - 0.12, dy - 0.1) / 0.09;
      if (r2 < 1) {
        rgba[i] = 158;
        rgba[i + 1] = 182;
        rgba[i + 2] = 255;
        rgba[i + 3] = 255;
      }
    }
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(join(root, 'public', file), png);
}

const splats = writeGaussian();
const points = writeCloud();
writeSphere();
writeCrate();
writeIcon(192, 'icon-192.png');
writeIcon(512, 'icon-512.png');
writeFileSync(
  join(root, 'public', 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="#12161e"/>
  <circle cx="28" cy="30" r="14" fill="#7ee0c6"/>
  <circle cx="40" cy="36" r="7" fill="#9eb6ff"/>
</svg>
`,
);
console.log(`generated torus splats=${splats} cloud points=${points}`);
