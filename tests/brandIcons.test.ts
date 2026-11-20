import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

describe('static complete Omniview O identity', () => {
  it('keeps the master, transparent header and favicon source assets consistent', () => {
    const master = readFileSync('assets/brand/omniview.svg', 'utf8');
    const mark = master.replace(/\s*<rect width="1024" height="1024"[^>]*\/>/, '');
    expect(readFileSync('public/logo.svg', 'utf8')).toBe(mark);
    expect(readFileSync('assets/brand/omniview-mark.svg', 'utf8')).toBe(mark);
    expect(readFileSync('public/favicon.svg', 'utf8')).toBe(readFileSync('assets/brand/omniview-favicon.svg', 'utf8'));
    expect(mark).toContain('<circle');
    expect(mark).not.toMatch(/animate|dasharray|opacity|ellipse|rotate/);
  });

  it.each([16, 20, 24])('renders a closed opaque ring with a clear center at %spx', async (size) => {
    const { data } = await sharp(readFileSync('public/logo.svg')).resize(size, size).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => data[(y * size + x) * 4 + 3];
    const center = Math.floor(size / 2), near = Math.floor(size / 8), far = size - 1 - near;
    for (const [x, y] of [[center, near], [center, far], [near, center], [far, center]]) expect(pixel(x, y)).toBeGreaterThan(200);
    expect(pixel(center, center)).toBe(0);
  });

  it('keeps the generated PNG favicon exactly derived from the SVG', async () => {
    const png = await sharp(readFileSync('public/favicon.svg'), { density: 384 }).resize(32, 32).png().toBuffer();
    expect(readFileSync('public/favicon-32.png')).toEqual(png);
  });
});
