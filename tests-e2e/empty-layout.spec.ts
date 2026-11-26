import { expect, test } from './test';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { releaseFlyLook } from './flyLook';

const sizes = [
  { name: 'short-phone', width: 360, height: 420 },
  { name: 'portrait', width: 390, height: 844 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'desktop-200pct-equivalent', width: 640, height: 400 },
  { name: 'narrow-200pct-equivalent', width: 320, height: 420 },
];
for (const size of sizes) {
  test(`${size.name}: empty primary actions, guidance and samples are pointer reachable`, async ({ page }, info) => {
    page.setDefaultTimeout(3000);
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto('/');
    await expect(page.locator('#empty')).toBeVisible();
    const hitTesting = await page.evaluate(() => {
      const ids = ['empty', 'empty-open', 'empty-multi', 'toolbar', 'toast', 'panel'];
      return ids.map((id) => {
        const element = document.getElementById(id);
        if (!element) throw new Error(`Missing ${id}`);
        const box = element.getBoundingClientRect(); const x = box.x + box.width / 2; const y = box.y + box.height / 2;
        return { id, box: box.toJSON(), hidden: element.hidden, display: getComputedStyle(element).display,
          hit: document.elementFromPoint(x, y)?.closest('[id]')?.id };
      });
    });
    await page.screenshot({ path: info.outputPath('initial.png') });
    await writeFile(info.outputPath('initial-hit-testing.json'), JSON.stringify(hitTesting, null, 2));
    const open = page.locator('#empty-open');
    await open.scrollIntoViewIfNeeded();
    const box = await open.boundingBox();
    if (!box) throw new Error('Choose file has no hit area');
    const left = Math.max(0, box.x); const right = Math.min(size.width, box.x + box.width);
    const top = Math.max(0, box.y); const bottom = Math.min(size.height, box.y + box.height);
    expect(right).toBeGreaterThan(left); expect(bottom).toBeGreaterThan(top);
    // Use native pointer activation in the lower hit area, never force or a DOM click.
    const point = { x: (left + right) / 2, y: top + (bottom - top) * 0.8 };
    await writeFile(info.outputPath('pointer-hit-testing.json'), JSON.stringify(await page.evaluate((point) => ({
      point, hit: document.elementFromPoint(point.x, point.y)?.closest('[id]')?.id,
    }), point), null, 2));
    await page.evaluate(() => {
      const events: unknown[] = [];
      Object.defineProperty(window, '__qaPointerEvents', { value: events });
      for (const type of ['pointerdown', 'pointerup', 'click']) document.addEventListener(type, (event) => {
        const target = event.target;
        events.push({ type, target: target instanceof Element ? target.closest('[id]')?.id : null,
          scroll: document.querySelector('.empty-card')?.scrollTop });
      }, true);
    });
    const [file] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 3000 }),
      open.click({ position: { x: point.x - box.x, y: point.y - box.y } }),
    ]).finally(async () => {
      await writeFile(info.outputPath('pointer-events.json'), JSON.stringify(await page.evaluate(() => Reflect.get(window, '__qaPointerEvents')), null, 2));
    });
    expect(file.isMultiple()).toBe(true);
    await file.setFiles([]);
    const card = await page.locator('#empty .empty-card').boundingBox();
    if (!card) throw new Error('Missing start card');
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(size.width);
    await page.locator('.empty-formats').scrollIntoViewIfNeeded();
    await expect(page.locator('.empty-formats')).toBeInViewport({ ratio: 1 });
    await page.locator('#empty-url').click();
    await expect(page.locator('#url-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('#empty-multi').scrollIntoViewIfNeeded();
    await expect(page.locator('#empty-multi')).toBeInViewport({ ratio: 1 });
    const [folder] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#empty-folder').click()]);
    expect(await folder.element().getAttribute('webkitdirectory')).not.toBeNull();
    await page.screenshot({ path: info.outputPath('guidance.png') });
    const crate = page.locator('#empty [data-sample="crate"]');
    await crate.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('samples.png') });
    await crate.click();
    await expect(page.locator('#file-name')).toHaveText('crate.glb');
    await expect(page.locator('#empty')).toBeHidden();
    await expect(page.locator('#toolbar')).toBeVisible();
    await page.locator('#mode-fly').click();
    await expect(page.locator('#mode-fly')).toHaveAttribute('aria-pressed', 'true');
    await releaseFlyLook(page);
    await page.locator('#mode-orbit').click();
    await expect(page.locator('#mode-orbit')).toHaveAttribute('aria-pressed', 'true');
    // The same native pointer/filechooser path can also adopt a normal local scene.
    const [anotherFile] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#open-btn').click()]);
    await anotherFile.setFiles(path.resolve('tests-e2e/fixtures/framing-cube.glb'));
    await expect(page.locator('#file-name')).toHaveText('framing-cube.glb');
  });
}

test('short empty screen supports Enter and keyboard focus scrolling to guidance', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  // Register before navigation so Chromium chooser interception precedes fast keyboard activation.
  const fileChooser = page.waitForEvent('filechooser');
  await page.goto('/');
  await expect(page.locator('#empty')).toBeVisible();
  await page.locator('#empty-open').focus();
  await expect(page.locator('#empty-open')).toBeFocused();
  await page.keyboard.press('Enter');
  const file = await fileChooser;
  await file.setFiles([]);
  await page.keyboard.press('Tab');
  await expect(page.locator('#empty-url')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#empty-folder')).toBeFocused();
  await expect(page.locator('#empty-folder')).toBeInViewport({ ratio: 1 });
});
