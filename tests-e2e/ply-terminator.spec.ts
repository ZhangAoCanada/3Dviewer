import { expect, test } from './test';
import { readFile } from 'node:fs/promises';
const cases = [
  ['space-LF', 'ascii', ' ', '\n'],
  ['tab-LF', 'ascii', '\t', '\n'],
  ['space-CRLF', 'ascii', ' ', '\r\n'],
  ['mixed-CR', 'ascii', ' \t ', '\r'],
  ['binary-LE-mixed-CRLF', 'binary_little_endian', ' \t ', '\r\n'],
  ['binary-BE-tab-LF', 'binary_big_endian', '\t', '\n'],
] satisfies [string, string, string, string][];
for (const [name, format, whitespace, ending] of cases) {
  test(`application accepts PLY terminator ${name}`, async ({ page }) => {
    const header = Buffer.from(`ply\nformat ${format} 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\ncomment ordinary metadata\nend_header${whitespace}${ending}`);
    const body = format === 'ascii' ? Buffer.from('1 2 3\n') : Buffer.alloc(12);
    if (format !== 'ascii') {
      const set = format === 'binary_big_endian' ? body.writeFloatBE.bind(body) : body.writeFloatLE.bind(body);
      set(1, 0); set(2, 4); set(3, 8);
    }
    await page.goto('/');
    await page.locator('#file-input').setInputFiles({ name: `${name}.ply`, mimeType: 'application/octet-stream', buffer: Buffer.concat([header, body]) });
    await expect(page.locator('#file-name')).toHaveText(`${name}.ply`);
    await expect(page.locator('#file-kind')).toHaveText('Points');
    const count = page.locator('#scene-info dt').filter({ hasText: /^Points$/ }).locator('xpath=following-sibling::dd[1]');
    await expect(count).toHaveText('1');
  });
}
test('application Gaussian import uses the same whitespace boundary', async ({ page }) => {
  const original = await readFile('public/samples/torus.ply');
  const marker = Buffer.from('end_header\n'); const at = original.indexOf(marker);
  if (at < 0) throw new Error('Missing fixture boundary');
  const buffer = Buffer.concat([original.subarray(0, at), Buffer.from('end_header \t\r\n'), original.subarray(at + marker.length)]);
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'whitespace-gaussian.ply', mimeType: 'application/octet-stream', buffer });
  await expect(page.locator('#file-name')).toHaveText('whitespace-gaussian.ply');
  await expect(page.locator('#file-kind')).toHaveText('Splats');
});
