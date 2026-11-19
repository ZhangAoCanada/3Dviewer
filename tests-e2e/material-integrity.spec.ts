import { expect, test, type Page } from './test';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const fixtures = path.resolve('tests-e2e/fixtures/material-paths');
test.beforeEach(async ({ page }) => {
  await page.route('**/api.github.com/repos/ZhangAoCanada/3Dviewer/releases/latest', (route) => route.fulfill({ json: { tag_name: 'v0.3.0' } }));
});
async function colors(page: Page): Promise<{ red: number; blue: number }> {
  const { data, info } = await sharp(await page.locator('#view').screenshot()).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let red = 0; let blue = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    if (data[i] > 200 && data[i + 1] < 50 && data[i + 2] < 50) red += 1;
    if (data[i + 2] > 200 && data[i + 1] < 50 && data[i] < 50) blue += 1;
  }
  return { red, blue };
}
async function unlit(page: Page): Promise<void> {
  await page.click('#panel-btn'); await page.selectOption('#shading', 'flat');
}
test('local folder keeps each MTL texture base and both Unlit groups', async ({ page }) => {
  await page.goto('/'); await page.locator('#folder-input').setInputFiles(fixtures);
  await expect(page.locator('#file-name')).toHaveText('model.obj'); await unlit(page);
  await expect.poll(async () => { const c = await colors(page); return c.red > 100 && c.blue > 100; }).toBe(true);
});
test('remote libraries request their own sibling textures', async ({ page }) => {
  const requested: string[] = [];
  await page.route('**/qa/**', async (route) => {
    const relative = new URL(route.request().url()).pathname.split('/qa/')[1];
    requested.push(relative);
    const body = await fs.readFile(path.join(fixtures, relative)).catch(() => null);
    await route.fulfill(body ? { body, contentType: relative.endsWith('.png') ? 'image/png' : 'text/plain' } : { status: 404 });
  });
  await page.goto('/?url=' + encodeURIComponent('/3Dviewer/qa/model.obj'));
  await expect(page.locator('#file-name')).toHaveText('model.obj'); await unlit(page);
  await expect.poll(async () => { const c = await colors(page); return c.red > 100 && c.blue > 100; }).toBe(true);
  expect(requested).toContain('a/tex.png'); expect(requested).toContain('b/tex.png');
});
test('late OBJ texture repaints an idle scene without navigation', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/qa/**', async (route) => {
    const file = new URL(route.request().url()).pathname.split('/qa/')[1];
    if (file === 'tex.png') await gate;
    let body: Buffer;
    if (file === 'late.obj') body = Buffer.from((await fs.readFile(path.join(fixtures, 'model.obj'), 'utf8')).replace('a/one.mtl b/two.mtl', 'late.mtl').replace('usemtl two', 'usemtl one'));
    else if (file === 'late.mtl') body = Buffer.from('newmtl one\nKd 1 1 1\nmap_Kd tex.png');
    else body = await fs.readFile(path.join(fixtures, 'a/tex.png'));
    await route.fulfill({ body, contentType: file.endsWith('.png') ? 'image/png' : 'text/plain' });
  });
  await page.goto('/?url=' + encodeURIComponent('/3Dviewer/qa/late.obj'));
  await expect(page.locator('#file-name')).toHaveText('late.obj'); await unlit(page);
  await expect(page.locator('#hud-fps')).toHaveText('Idle');
  expect((await colors(page)).red).toBe(0);
  release();
  await expect.poll(async () => (await colors(page)).red).toBeGreaterThan(100);
});
test('a failed flipped sample does not change the next local scene orientation setting', async ({ page }) => {
  await page.route('https://sparkjs.dev/assets/splats/butterfly.spz', (route) => route.fulfill({ status: 404 }));
  await page.goto('/?sample=crate'); await expect(page.locator('#file-name')).toHaveText('crate.glb');
  await page.click('#samples-btn'); await page.locator('#samples-menu [role="menuitem"]').filter({ hasText: 'Butterfly' }).click();
  await expect(page.locator('#problem')).toBeVisible();
  await expect(page.locator('#flip-y')).not.toBeChecked();
  await page.locator('#file-input').setInputFiles(path.resolve('tests-e2e/fixtures/framing-cube.glb'));
  await expect(page.locator('#file-name')).toHaveText('framing-cube.glb');
  await expect(page.locator('#flip-y')).not.toBeChecked();
});
