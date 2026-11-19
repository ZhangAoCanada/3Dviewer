import { expect, test, type Page } from './test';
import sharp from 'sharp';
import path from 'node:path';

async function sceneBounds(page: Page): Promise<{ left: number; top: number; right: number; bottom: number; width: number; height: number }> {
  const image = await page.locator('#view').screenshot();
  const { data, info } = await sharp(image).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width; let top = info.height; let right = -1; let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      if (data[i] > 220 && data[i + 1] < 30 && data[i + 2] > 220) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
  }
  return { left, top, right, bottom, width: info.width, height: info.height };
}

async function frames(page: Page, count = 8): Promise<void> {
  await page.evaluate(async (n) => {
    for (let i = 0; i < n; i += 1) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, count);
}

function fits(bounds: Awaited<ReturnType<typeof sceneBounds>>): boolean {
  return bounds.right > bounds.left && bounds.bottom > bounds.top && bounds.left > 2 &&
    bounds.right < bounds.width - 3 && bounds.top > 2 && bounds.bottom < bounds.height - 3;
}

test.use({ viewport: { width: 390, height: 844 } });

test('portrait fit is complete, resize preserves a user view, and Reset fits the current aspect', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(path.resolve('tests-e2e/fixtures/framing-cube.glb'));
  await expect(page.locator('#file-name')).toHaveText('framing-cube.glb');
  await expect.poll(async () => fits(await sceneBounds(page))).toBe(true);
  const toastClose = page.locator('#toast-close');
  if (await toastClose.isVisible()) await toastClose.click();
  const portrait = info.outputPath('portrait-fit.png');
  await page.screenshot({ path: portrait });
  await info.attach('portrait-fit', { path: portrait, contentType: 'image/png' });
  await page.click('#mode-fly');
  const initial = await sceneBounds(page);
  await page.keyboard.down('w'); await frames(page); await page.keyboard.up('w');
  const moved = await sceneBounds(page);
  expect(moved).not.toEqual(initial);
  await page.setViewportSize({ width: 844, height: 390 }); await frames(page, 2);
  await page.setViewportSize({ width: 390, height: 844 }); await frames(page, 2);
  expect(await sceneBounds(page)).toEqual(moved);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.click('#reset-btn');
  await expect.poll(async () => fits(await sceneBounds(page))).toBe(true);
  const landscape = info.outputPath('landscape-reset.png');
  await page.screenshot({ path: landscape });
  await info.attach('landscape-reset', { path: landscape, contentType: 'image/png' });
});
