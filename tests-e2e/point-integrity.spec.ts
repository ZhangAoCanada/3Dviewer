import { expect, test } from './test';
test('invalid point data is rejected and a subsequent integer-coordinate cloud loads normally', async ({ page }) => {
  const header = 'ply\nformat ascii 1.0\nelement vertex 2\nproperty int x\nproperty int y\nproperty int z\nend_header\n';
  await page.goto('/');
  await page.locator('#file-input').setInputFiles({ name: 'truncated.ply', mimeType: 'application/octet-stream', buffer: Buffer.from(header + '0 0 0\n') });
  await expect(page.locator('#problem')).toBeVisible();
  await page.locator('#file-input').setInputFiles({ name: 'valid.ply', mimeType: 'application/octet-stream', buffer: Buffer.from(header + '1 2 3\n4 6 8\n') });
  await expect(page.locator('#file-name')).toHaveText('valid.ply'); await expect(page.locator('#problem')).toBeHidden();
  await expect(page.locator('#hud-points')).toHaveText('2');
});
