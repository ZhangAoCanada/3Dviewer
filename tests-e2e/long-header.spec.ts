import { expect, test } from './test';
import { readFile } from 'node:fs/promises';
function fixture(format: string, properties: boolean): Buffer {
  const extra = properties
    ? Array.from({ length: 4000 }, (_, i) => `property uchar padding_${i}_${'a'.repeat(50)}\n`).join('')
    : `comment ${'a'.repeat(72000)}\n`;
  const header = Buffer.from(`ply\nformat ${format} 1.0\nelement vertex 1\nproperty float x\n${extra}property float y\nproperty float z\nend_header\n`);
  if (format === 'ascii') return Buffer.concat([header, Buffer.from(`1 ${properties ? '0 '.repeat(4000) : ''}2 3\n`)]);
  const body = Buffer.alloc(12 + (properties ? 4000 : 0));
  const set = format === 'binary_big_endian' ? body.writeFloatBE.bind(body) : body.writeFloatLE.bind(body);
  set(1, 0); set(2, body.length - 8); set(3, body.length - 4);
  return Buffer.concat([header, body]);
}
for (const [format, properties] of [['ascii', false], ['binary_little_endian', false], ['binary_big_endian', false], ['ascii', true], ['binary_little_endian', true]] as const) {
  test(`application imports ${format} with long ${properties ? 'property layout' : 'comment'} header`, async ({ page }) => {
    await page.goto('/');
    await page.locator('#file-input').setInputFiles({ name: 'long-header.ply', mimeType: 'application/octet-stream', buffer: fixture(format, properties) });
    await expect(page.locator('#file-name')).toHaveText('long-header.ply');
    await expect(page.locator('#file-kind')).toHaveText('Points');
    const pointCount = page.locator('#scene-info dt').filter({ hasText: /^Points$/ }).locator('xpath=following-sibling::dd[1]');
    await expect(pointCount).toHaveText('1');
  });
}
test('a Gaussian declaration after the initial probe still selects Gaussian import', async ({ page }) => {
  const original = await readFile('public/samples/torus.ply');
  const buffer = Buffer.concat([original.subarray(0, 4), Buffer.from(`comment ${'a'.repeat(72000)}\n`), original.subarray(4)]);
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'long-gaussian.ply', mimeType: 'application/octet-stream', buffer });
  await expect(page.locator('#file-name')).toHaveText('long-gaussian.ply');
  await expect(page.locator('#file-kind')).toHaveText('Splats');
});
