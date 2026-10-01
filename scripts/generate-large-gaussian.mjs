/**
 * Stream a synthetic INRIA Gaussian PLY with the owner's 62-float layout and a
 * deliberately wrong `element vertex` count. The file is not committed.
 *
 *   node scripts/generate-large-gaussian.mjs --count 10000000 --out tmp/large-gaussian.ply
 */
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const SH_C0 = 0.28209479177387814;
const HEADER_COUNT = 17168;

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

const count = Number(arg('count', '1000000'));
const out = arg('out', 'tmp/large-gaussian.ply');
if (!Number.isInteger(count) || count < 1) {
  console.error('--count must be a positive integer');
  process.exit(1);
}

const props = ['x', 'y', 'z', 'nx', 'ny', 'nz', 'f_dc_0', 'f_dc_1', 'f_dc_2'];
for (let i = 0; i < 45; i += 1) props.push(`f_rest_${i}`);
props.push('opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3');

const cols = Math.ceil(Math.sqrt(count));
const span = 48;
const header = [
  'ply',
  'format binary_little_endian 1.0',
  'comment offsetx 539022.5123',
  'comment offsety 3377206.7481',
  'comment offsetz 22.956',
  'comment epsg 4547',
  'comment minx -24',
  'comment miny -6',
  'comment minz -24',
  'comment maxx 24',
  'comment maxy 8',
  'comment maxz 24',
  `element vertex ${HEADER_COUNT}`,
  ...props.map((name) => `property float ${name}`),
  'end_header',
  '',
].join('\n');

await mkdir(dirname(out), { recursive: true });
const stream = createWriteStream(out);
const chunkSplats = 32_768;
const stride = 62;
const buffer = Buffer.allocUnsafe(chunkSplats * stride * 4);
let written = 0;

function colorAt(x, z) {
  const t = (x / span) * 0.5 + 0.5;
  const u = (z / span) * 0.5 + 0.5;
  return [0.15 + 0.75 * t, 0.35 + 0.4 * (1 - u), 0.25 + 0.55 * u];
}

function fill(from, to) {
  let offset = 0;
  for (let i = from; i < to; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col / Math.max(1, cols - 1) - 0.5) * span;
    const z = (row / Math.max(1, cols - 1) - 0.5) * span;
    const y = Math.sin(x * 0.35) * Math.cos(z * 0.28) * 3.2;
    const [r, g, b] = colorAt(x, z);
    buffer.writeFloatLE(x, offset);
    buffer.writeFloatLE(y, offset + 4);
    buffer.writeFloatLE(z, offset + 8);
    buffer.writeFloatLE(0, offset + 12);
    buffer.writeFloatLE(1, offset + 16);
    buffer.writeFloatLE(0, offset + 20);
    buffer.writeFloatLE((r - 0.5) / SH_C0, offset + 24);
    buffer.writeFloatLE((g - 0.5) / SH_C0, offset + 28);
    buffer.writeFloatLE((b - 0.5) / SH_C0, offset + 32);
    for (let rest = 0; rest < 45; rest += 1) {
      const band = rest % 15;
      const amp = band < 3 ? 0.08 : band < 8 ? 0.04 : 0.02;
      buffer.writeFloatLE(amp * Math.sin(i * 0.001 + rest), offset + 36 + rest * 4);
    }
    buffer.writeFloatLE(2.2, offset + 216);
    buffer.writeFloatLE(-4.4, offset + 220);
    buffer.writeFloatLE(-4.6, offset + 224);
    buffer.writeFloatLE(-4.5, offset + 228);
    buffer.writeFloatLE(1, offset + 232);
    buffer.writeFloatLE(0, offset + 236);
    buffer.writeFloatLE(0, offset + 240);
    buffer.writeFloatLE(0, offset + 244);
    offset += stride * 4;
  }
  return offset;
}

await new Promise((resolve, reject) => {
  stream.on('error', reject);
  stream.write(header, (error) => (error ? reject(error) : resolve()));
});

const started = Date.now();
while (written < count) {
  const take = Math.min(chunkSplats, count - written);
  const bytes = fill(written, written + take);
  const slice = bytes === buffer.length ? buffer : buffer.subarray(0, bytes);
  await new Promise((resolve, reject) => {
    stream.write(slice, (error) => (error ? reject(error) : resolve()));
  });
  written += take;
  if (written === take || written % (chunkSplats * 8) === 0 || written === count) {
    const sec = (Date.now() - started) / 1000;
    process.stdout.write(`\r${written.toLocaleString()} / ${count.toLocaleString()} splats  ${sec.toFixed(1)}s`);
  }
}
await new Promise((resolve, reject) => stream.end((error) => (error ? reject(error) : resolve())));
process.stdout.write('\n');
console.log(`wrote ${out}`);
