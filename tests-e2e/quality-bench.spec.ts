import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator.serviceWorker, 'ready', { value: Promise.resolve() }));
  await page.route('**/api.github.com/repos/ZhangAoCanada/3Dviewer/releases/latest', (route) => route.fulfill({ json: { tag_name: 'v0.3.0' } }));
});
test('quality group is one Tab stop with arrow, Home and End selection', async ({ page }) => {
  await page.goto('/?sample=crate'); await expect(page.locator('#file-name')).toHaveText('crate.glb'); await page.click('#panel-btn');
  const auto = page.locator('#quality-auto'); const quality = page.locator('#quality-quality'); const memory = page.locator('#quality-memory');
  await expect(auto).toHaveAttribute('tabindex', '0'); await expect(quality).toHaveAttribute('tabindex', '-1');
  await auto.focus(); await page.keyboard.press('ArrowRight'); await expect(quality).toBeFocused(); await expect(quality).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('End'); await expect(memory).toBeFocused(); await expect(memory).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('Home'); await expect(auto).toBeFocused(); await expect(auto).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('ArrowLeft'); await expect(memory).toBeFocused();
});
async function stalledReload(page: Page): Promise<void> {
  let gets = 0;
  await page.route('**/samples/crate.glb', (route) => {
    if (route.request().method() !== 'GET' || ++gets === 1) return route.continue();
    return undefined;
  });
  await page.goto('/?sample=crate&bench=1');
  await expect(page.locator('#file-name')).toHaveText('crate.glb');
  // The scripted orbit itself takes six seconds, before the first reload.
  await expect.poll(() => gets, { timeout: 15_000 }).toBe(2);
  await expect(page.locator('#loading')).toBeVisible();
}
test('Cancel stops the benchmark-owned stalled reload promptly', async ({ page }) => {
  await stalledReload(page); await page.click('#bench-cancel');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 1000 });
  await expect(page.locator('#bench-status')).toHaveText('Stopped.');
  await expect(page.locator('body')).toHaveAttribute('data-loads', '0');
});
test('benchmark cancellation cannot cancel a newer user import', async ({ page }) => {
  await stalledReload(page);
  await page.locator('#file-input').setInputFiles(path.resolve('tests-e2e/fixtures/framing-cube.glb'));
  await page.click('#bench-cancel');
  await expect(page.locator('#file-name')).toHaveText('framing-cube.glb');
  await expect(page.locator('#loading')).toBeHidden();
});
