import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const master = readFileSync('assets/brand/omniview.svg');
const mark = readFileSync('public/logo.svg');

describe('approved v5 Omniview identity', () => {
  it('pins the exact user-approved master, not aligned-v6 or the previous solid ring', () => {
    expect(createHash('sha256').update(master).digest('hex')).toBe('3b95ee43fcbc552839d869c7c790d010829fc63cc2601e1dd3c6ef0de6114915');
    expect(mark.toString().match(/<ellipse /g)).toHaveLength(7);
    expect(mark.toString()).not.toMatch(/<animate|<script|<image|https?:\/\/(?!www.w3.org)/);
    expect(mark.toString()).not.toContain('translate(367.576 833)');
    expect(mark).toEqual(readFileSync('assets/brand/omniview-mark.svg'));
    expect(mark).toEqual(readFileSync('assets/brand/omniview-favicon.svg'));
    expect(mark).toEqual(readFileSync('public/favicon.svg'));
  });

  it('renders the complete symbol identically to its approved master crop on white', async () => {
    const reference = await sharp(master).extract({ left: 232, top: 142, width: 560, height: 560 }).removeAlpha().raw().toBuffer();
    const actual = await sharp(mark).flatten({ background: 'white' }).removeAlpha().raw().toBuffer();
    expect(actual.length).toBe(reference.length);
    let total = 0;
    for (let i = 0; i < actual.length; i += 1) total += Math.abs(actual[i] - reference[i]);
    expect(total / actual.length).toBeLessThan(0.5);
  });

  it('keeps full transparent lockups faithful and changes only dark wordmark color', () => {
    const lockup = master.toString().replace('<rect width="1024" height="1024" fill="white"/>', '');
    expect(readFileSync('assets/brand/omniview-lockup.svg', 'utf8')).toBe(lockup);
    expect(readFileSync('public/brand-lockup.svg', 'utf8')).toBe(lockup);
    const dark = lockup.replace('<g fill="#17373a"', '<g fill="#e5f6f3"');
    expect(readFileSync('assets/brand/omniview-lockup-dark.svg', 'utf8')).toBe(dark);
    expect(readFileSync('public/brand-lockup-dark.svg', 'utf8')).toBe(dark);
  });

  it.each([16, 20, 24, 32])('has a transparent center/corners and visible faithful artwork at %spx', async (size) => {
    const { data } = await sharp(mark).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * size + x) * 4 + 3];
    expect(alpha(Math.floor(size / 2), Math.floor(size / 2))).toBe(0);
    for (const [x, y] of [[0, 0], [0, size - 1], [size - 1, 0], [size - 1, size - 1]]) expect(alpha(x, y)).toBe(0);
    expect(alpha(Math.floor(size / 2), Math.floor(size / 8))).toBeGreaterThan(200);
    expect([...data].filter((_, i) => i % 4 === 3 && data[i] > 32).length).toBeGreaterThan(size * size / 5);
  });

  it('keeps the PNG favicon exactly derived and its ICO frames complete', async () => {
    const png = await sharp(mark, { density: 384 }).resize(32, 32).png().toBuffer();
    expect(readFileSync('public/favicon-32.png').equals(png)).toBe(true);
    const ico = readFileSync('public/favicon.ico');
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(2);
    for (let i = 0; i < 2; i += 1) {
      const entry = 6 + i * 16, size = ico[entry];
      const image = ico.subarray(ico.readUInt32LE(entry + 12), ico.readUInt32LE(entry + 12) + ico.readUInt32LE(entry + 8));
      expect([16, 32]).toContain(size);
      expect(await sharp(image).metadata()).toMatchObject({ width: size, height: size, format: 'png' });
    }
  });

  it.each([192, 512])('keeps the normal PWA %spx icon transparent and exactly derived', async (size) => {
    const image = readFileSync(`public/icon-${size}.png`);
    expect(image.equals(await sharp(mark, { density: 384 }).resize(size, size).png().toBuffer())).toBe(true);
    expect(await sharp(image).metadata()).toMatchObject({ width: size, height: size, hasAlpha: true });
  });

  it('contains the full maskable artwork inside its circular safe area on an intentional opaque tile', async () => {
    const { data, info } = await sharp('public/icon-512-maskable.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(512);
    let colored = 0, minAlpha = 255, maxRadius = 0;
    for (let y = 0; y < 512; y += 1) for (let x = 0; x < 512; x += 1) {
      const i = (y * 512 + x) * 4;
      minAlpha = Math.min(minAlpha, data[i + 3]);
      if (Math.abs(data[i] - 248) + Math.abs(data[i + 1] - 250) + Math.abs(data[i + 2] - 252) < 6) continue;
      colored += 1;
      maxRadius = Math.max(maxRadius, Math.hypot(x + 0.5 - 256, y + 0.5 - 256));
    }
    expect(colored).toBeGreaterThan(20000);
    expect(minAlpha).toBe(255);
    expect(maxRadius).toBeLessThan(204.8);
  });

  it('provides decodable desktop PNGs and structurally complete Windows/macOS containers', async () => {
    for (const file of readdirSync('src-tauri/icons').filter((name) => name.endsWith('.png'))) {
      const metadata = await sharp(`src-tauri/icons/${file}`).metadata();
      expect(metadata.width).toBe(metadata.height);
      expect(metadata.width).toBeGreaterThan(0);
    }
    const png = readFileSync('src-tauri/icons/icon.png');
    expect(await sharp(png).metadata()).toMatchObject({ width: 512, height: 512, hasAlpha: true });
    // Compare visible pixels: transparent RGB and resampling kernels differ
    // between librsvg/sharp and the platform icon encoder.
    for (const background of ['white', '#0c0f14']) {
      const actual = await sharp(png).flatten({ background }).raw().toBuffer();
      const expected = await sharp(mark, { density: 384 }).resize(512, 512).flatten({ background }).raw().toBuffer();
      let error = 0;
      for (let i = 0; i < actual.length; i += 1) error += Math.abs(actual[i] - expected[i]);
      expect(error / actual.length).toBeLessThan(1);
    }
    const ico = readFileSync('src-tauri/icons/icon.ico');
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThan(1);
    for (let i = 0; i < ico.readUInt16LE(4); i += 1) {
      const p = 6 + i * 16;
      expect(ico.readUInt32LE(p + 12) + ico.readUInt32LE(p + 8)).toBeLessThanOrEqual(ico.length);
    }
    const icns = readFileSync('src-tauri/icons/icon.icns');
    expect(icns.subarray(0, 4).toString()).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    let offset = 8, chunks = 0;
    while (offset < icns.length) {
      const length = icns.readUInt32BE(offset + 4);
      expect(length).toBeGreaterThan(8);
      offset += length;
      chunks += 1;
    }
    expect(offset).toBe(icns.length);
    expect(chunks).toBeGreaterThan(3);
  });
});
