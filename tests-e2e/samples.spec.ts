import { expect, test } from '@playwright/test';

test('start screen offers three quiet sample links and hides the rest', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#empty-open')).toBeVisible();
  await expect(page.locator('#empty-samples-prompt')).toHaveText('No file handy? Try a sample:');
  await expect(page.locator('.sample-card, .sample-thumb, #empty-samples img')).toHaveCount(0);

  const picks = page.locator('#empty-sample-picks .sample-pill');
  await expect(picks).toHaveText(['Torus splat', 'Crate', 'Point cloud']);
  await expect(page.locator('#empty-samples-rest')).toBeHidden();
  await expect(page.locator('#empty-samples-more')).toHaveAttribute('aria-expanded', 'false');

  const openBox = await page.locator('#empty-open').boundingBox();
  const pillBox = await picks.first().boundingBox();
  expect(openBox).not.toBeNull();
  expect(pillBox).not.toBeNull();
  expect(openBox!.height).toBeGreaterThan(pillBox!.height);
  expect(openBox!.y).toBeLessThan(pillBox!.y);

  const closed = await page.locator('#empty-samples').boundingBox();
  expect(closed).not.toBeNull();
  expect(closed!.height).toBeLessThan(48);
  const rowYs = await page.locator('#empty-samples-prompt, #empty-sample, #empty-samples-more').evaluateAll((nodes) =>
    nodes.map((node) => Math.round(node.getBoundingClientRect().y)),
  );
  expect(Math.max(...rowYs) - Math.min(...rowYs)).toBeLessThanOrEqual(2);

  await page.click('#empty-samples-more');
  await expect(page.locator('#empty-samples-rest')).toBeVisible();
  await expect(page.locator('#empty-samples-more')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#empty-samples-rest .sample-pill')).toHaveText(['Torus', 'Sphere', 'Butterfly']);
  await expect(page.locator('#empty-samples img')).toHaveCount(0);

  await page.click('#empty-samples-more');
  await expect(page.locator('#empty-samples-rest')).toBeHidden();

  await page.click('#empty-sample');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#file-name')).toHaveText('torus.splat');
  await expect(page).toHaveURL(/[?&]sample=torus-splat(?:&|$)/);
});

test('a sample deep link still opens that sample', async ({ page }) => {
  await page.goto('/?sample=sphere');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#file-name')).toHaveText('sphere.obj');
  await expect(page.locator('#empty')).toBeHidden();
});

test('phone width keeps the sample links in one short row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  const block = await page.locator('#empty-samples').boundingBox();
  const open = await page.locator('#empty-open').boundingBox();
  expect(block).not.toBeNull();
  expect(open).not.toBeNull();
  expect(block!.height).toBeLessThan(96);
  expect(open!.y).toBeLessThan(block!.y);
  await expect(page.locator('#empty-samples img')).toHaveCount(0);
});
