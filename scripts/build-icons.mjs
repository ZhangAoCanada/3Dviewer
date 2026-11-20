#!/usr/bin/env node
/**
 * Build every Omniview icon from the exact approved v5 vector master.
 * See assets/brand/README.md for approval, crop and background policy.
 *
 * Writes the transparent header mark, the favicon set, PWA icons (including
 * a maskable 512 with the artwork inside the safe zone), and the Tauri
 * icons via `npx tauri icon`.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const brand = join(root, 'assets', 'brand');
const publicDir = join(root, 'public');
const tauriIcons = join(root, 'src-tauri', 'icons');
const TILE = { r: 248, g: 250, b: 252, alpha: 1 }; // #f8fafc

const masterSvg = readFileSync(join(brand, 'omniview.svg'));


// The master has one white presentation background and two top-level artwork
// groups. Preserve every symbol node/coordinate, gradient, mask and overlap.
function deriveBrand(svg) {
  const text = svg.toString();
  const background = '<rect width="1024" height="1024" fill="white"/>';
  const wordmark = '<g fill="#17373a" transform="translate(367.576 833)">';
  if (!text.includes(background) || text.split(wordmark).length !== 2 ||
      (text.match(/<ellipse /g) ?? []).length !== 7) {
    throw new Error('Approved v5 master structure changed; review brand derivation before regenerating');
  }
  const lockup = text.replace(background, '');
  const symbol = lockup.slice(0, lockup.indexOf(wordmark)) + '</svg>';
  const mark = symbol.replace('viewBox="0 0 1024 1024"', 'viewBox="232 142 560 560"')
    .replace('width="1024" height="1024"', 'width="560" height="560"');
  return { mark, lockup, darkLockup: lockup.replace(wordmark, wordmark.replace('#17373a', '#e5f6f3')) };
}

function pngIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = 6 + count * 16;
  const entries = images.map((image) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(image.size === 256 ? 0 : image.size, 0);
    entry.writeUInt8(image.size === 256 ? 0 : image.size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

async function raster(svg, size) {
  return sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer();
}

/** Scale so every opaque pixel sits inside the maskable safe circle (80% diameter). */
async function maskable(svg, size) {
  const probe = 1024;
  const { data, info } = await sharp(await raster(svg, probe)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cx = info.width / 2;
  const cy = info.height / 2;
  let maxR = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(y * info.width + x) * 4 + 3];
      if (alpha < 16) continue;
      const r = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (r > maxR) maxR = r;
    }
  }
  // 4% inside the safe circle so antialiasing does not spill past the mask.
  const scale = Math.min(1, (probe * 0.4 * 0.96) / maxR);
  const inner = Math.max(1, Math.round(size * scale));
  const icon = await sharp(await raster(svg, inner)).png().toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: TILE },
  })
    .composite([{ input: icon, gravity: 'center' }])
    .png()
    .toBuffer();
}

mkdirSync(publicDir, { recursive: true });
mkdirSync(tauriIcons, { recursive: true });

const { mark, lockup, darkLockup } = deriveBrand(masterSvg);
const faviconSvg = Buffer.from(mark);
writeFileSync(join(brand, 'omniview-mark.svg'), mark);
writeFileSync(join(brand, 'omniview-favicon.svg'), mark);
writeFileSync(join(brand, 'omniview-lockup.svg'), lockup);
writeFileSync(join(brand, 'omniview-lockup-dark.svg'), darkLockup);
writeFileSync(join(publicDir, 'brand-lockup.svg'), lockup);
writeFileSync(join(publicDir, 'brand-lockup-dark.svg'), darkLockup);
writeFileSync(join(publicDir, 'logo.svg'), mark);
writeFileSync(join(publicDir, 'favicon.svg'), faviconSvg);

const outputs = [
  ['icon-512.png', await raster(mark, 512)],
  ['icon-192.png', await raster(mark, 192)],
  ['apple-touch-icon.png', await sharp(await raster(mark, 180)).flatten({ background: TILE }).png().toBuffer()],
  ['icon-512-maskable.png', await maskable(mark, 512)],
  ['favicon-32.png', await raster(faviconSvg, 32)],
];
for (const [name, png] of outputs) {
  writeFileSync(join(publicDir, name), png);
}

const favicon16 = await raster(faviconSvg, 16);
const favicon32 = outputs.find(([name]) => name === 'favicon-32.png')[1];
writeFileSync(
  join(publicDir, 'favicon.ico'),
  pngIco([
    { size: 16, png: favicon16 },
    { size: 32, png: favicon32 },
  ]),
);

const temporary = mkdtempSync(join(tmpdir(), 'omniview-brand-'));
try {
  const sourcePng = join(temporary, 'omniview-1024.png');
  writeFileSync(sourcePng, await raster(mark, 1024));
  execFileSync(join(root, 'node_modules', '.bin', 'tauri'), ['icon', sourcePng, '-o', tauriIcons], {
    cwd: root,
    stdio: 'inherit',
  });
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

console.log('build-icons: public icons, header mark, and src-tauri/icons');
