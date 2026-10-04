import { expect, test } from '@playwright/test';

test('the selected quality preset persists across a reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await page.click('#panel-btn');
  await page.click('#quality-memory');
  await expect(page.locator('#quality-memory')).toHaveAttribute('aria-checked', 'true');
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#quality-memory')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#quality-auto')).toHaveAttribute('aria-checked', 'false');
});

test('advanced holds the decode controls and display does not', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#sec-advanced')).toContainText('SH degree');
  await expect(page.locator('#sec-advanced #sh-degree')).toHaveCount(1);
  await expect(page.locator('#sec-advanced #splat-scale')).toHaveCount(1);
  await expect(page.locator('#sec-advanced #lod-scale')).toHaveCount(1);
  await expect(page.locator('#sec-advanced #pixel-ratio')).toHaveCount(1);
  await expect(page.locator('#sec-advanced #gs-2d')).toHaveCount(1);
  await expect(page.locator('#sec-advanced #sort-radial')).toHaveCount(1);
  await expect(page.locator('#sec-advanced #extended')).toHaveCount(1);
  await expect(page.locator('#sec-display #sh-degree')).toHaveCount(0);
  await expect(page.locator('#sec-display')).toContainText('Quality');
  await expect(page.locator('#sec-perf #lod-scale')).toHaveCount(0);
  await expect(page.locator('#sec-perf #pixel-ratio')).toHaveCount(0);
});

test('lower memory on the torus sample reopens at sh 1 of 3', async ({ page }) => {
  await page.goto('/?sample=torus-ply');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#scene-info')).toContainText('sh');
  await page.click('#panel-btn');
  await page.click('#quality-memory');
  await expect(page.locator('#quality-reopen')).toBeVisible();
  await page.click('#quality-reopen');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#scene-info')).toContainText('1 of 3');
});

test('automatic uses a plain sentence and keeps the technical line closed', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#quality-summary')).toHaveText(
    'Automatic balances detail and memory for this device. Some changes require reopening the file.',
  );
  await expect(page.locator('#quality-details')).toHaveJSProperty('open', false);
  await expect(page.locator('#quality-details')).toContainText('level of detail off');
});

test('the torus sample names this scan and what Lower memory would reopen', async ({ page }) => {
  await page.goto('/?sample=torus-ply');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#quality-consequence')).toContainText('This scan: 4,800 splats at SH 3 of 3');
  await page.click('#panel-btn');
  await page.click('#quality-memory');
  await expect(page.locator('#quality-consequence')).toContainText('Reopen to apply: SH 1 of 3');
});
