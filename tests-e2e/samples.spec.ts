import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test('start screen scrolls compact sample cards in one row', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#empty-open')).toBeVisible();
  await expect(page.locator('#empty-samples-prompt')).toHaveText('Try a sample');

  const cards = page.locator('.sample-card');
  await expect(cards).toHaveCount(6);
  await expect(page.locator('.sample-name')).toHaveText(['Torus', 'Torus splat', 'Point cloud', 'Crate', 'Sphere', 'Butterfly']);
  await expect(cards.locator('.badge')).toHaveText(['Splats', 'Splats', 'Points', 'Mesh', 'Mesh', 'Splats']);
  await expect
    .poll(async () =>
      page.locator('.sample-card img').evaluateAll((imgs) =>
        imgs.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
  await expect(page.locator('.sample-card img')).toHaveCount(5);

  const openBox = await page.locator('#empty-open').boundingBox();
  const cardBox = await cards.first().boundingBox();
  const block = await page.locator('#empty-samples').boundingBox();
  expect(openBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  expect(block).not.toBeNull();
  expect(openBox!.y).toBeLessThan(cardBox!.y);
  expect(openBox!.height).toBeGreaterThan(32);
  expect(block!.height).toBeLessThan(160);
  expect(block!.height).toBeGreaterThan(cardBox!.height);

  const ys = await cards.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().y)));
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(2);
  const snap = await page.locator('.sample-track').evaluate((el) => getComputedStyle(el).scrollSnapType);
  expect(snap).toContain('x');
  const overflow = await page.locator('.sample-track').evaluate((el) => el.scrollWidth > el.clientWidth + 8);
  expect(overflow).toBe(true);

  await expect(page.locator('#sample-prev')).toBeHidden();
  await expect(page.locator('#sample-next')).toBeVisible();
  await page.click('#sample-next');
  await expect.poll(async () => page.locator('.sample-track').evaluate((el) => el.scrollLeft)).toBeGreaterThan(20);
  await expect(page.locator('#sample-prev')).toBeVisible();
  await page.locator('.sample-track').evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
  });
  await expect(page.locator('#sample-next')).toBeHidden();
  await expect(page.locator('#sample-prev')).toBeVisible();

  await page.locator('#empty-sample').focus();
  await page.keyboard.press('ArrowRight');
  await expect(cards.nth(1)).toBeFocused();

  await page.click('#empty-sample');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#file-name')).toHaveText('torus.ply');
  await expect(page).toHaveURL(/[?&]sample=torus-ply(?:&|$)/);
});

test.describe('missing thumbnail', () => {
  test.use({ serviceWorkers: 'block' });

  test('a missing thumbnail keeps the icon and the card size', async ({ page }) => {
  await page.route('**/*.webp', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.sample-card')).toHaveCount(6);
  await expect.poll(() => page.locator('.sample-card img').count()).toBe(0);
  const thumbs = await page.locator('.sample-thumb').evaluateAll((nodes) =>
    nodes.map((node) => {
      const box = node.getBoundingClientRect();
      return {
        width: box.width,
        height: box.height,
        icon: node.querySelector('svg') != null,
        image: node.querySelector('img') != null,
      };
    }),
  );
  expect(thumbs).toHaveLength(6);
  for (const thumb of thumbs) {
    expect(thumb.icon).toBe(true);
    expect(thumb.image).toBe(false);
    expect(thumb.height).toBeGreaterThanOrEqual(50);
    expect(thumb.height).toBeLessThanOrEqual(54);
  }
  });
});

test('a sample deep link still opens that sample', async ({ page }) => {
  await page.goto('/?sample=sphere');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#file-name')).toHaveText('sphere.obj');
  await expect(page.locator('#empty')).toBeHidden();
});

test('every sample opens from the carousel, the menu, and a sample link', async ({ page }) => {
  test.setTimeout(180_000);
  const samples = [
    { id: 'torus-ply', file: 'torus.ply' },
    { id: 'torus-splat', file: 'torus.splat' },
    { id: 'cloud', file: 'cloud.ply' },
    { id: 'crate', file: 'crate.glb' },
    { id: 'sphere', file: 'sphere.obj' },
    { id: 'butterfly', file: 'butterfly.spz' },
  ];
  for (const sample of samples) {
    await page.goto('/');
    await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
    await page.locator(`[data-sample="${sample.id}"]`).click();
    await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
    await expect(page.locator('#file-name')).toHaveText(sample.file);
    await expect(page.locator('#problem')).toBeHidden();
    await expect(page.locator('#problem-desc')).not.toContainText('status 200');
  }

  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await page.click('#samples-btn');
  await page.locator('#samples-menu [role="menuitem"]').filter({ hasText: '3DGS torus (.ply)' }).click();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#file-name')).toHaveText('torus.ply');
  await expect(page).toHaveURL(/[?&]sample=torus-ply(?:&|$)/);

  await page.goto('/?sample=torus-ply');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#file-name')).toHaveText('torus.ply');
  await expect(page.locator('#problem')).toBeHidden();
});

test.describe('range response of 200', () => {
  test.use({ serviceWorkers: 'block' });

  test('torus loads when HEAD is gzip and a range request is not a partial response', async ({ page }) => {
    const body = readFileSync(new URL('../public/samples/torus.ply', import.meta.url));
    await page.route('**/samples/torus.ply', async (route) => {
      if (route.request().method() === 'HEAD') {
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-encoding': 'gzip',
            'content-length': '41416',
            'accept-ranges': 'bytes',
          },
          body: '',
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
        body,
      });
    });
    await page.goto('/?sample=torus-ply');
    await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
    await expect(page.locator('#file-name')).toHaveText('torus.ply');
    await expect(page.locator('#problem')).toBeHidden();
    await expect(page.locator('#problem-desc')).not.toContainText('status 200');
  });

  test('torus loads when a ranged GET comes back as 200 with the whole file', async ({ page }) => {
    const body = readFileSync(new URL('../public/samples/torus.ply', import.meta.url));
    await page.route('**/samples/torus.ply', async (route) => {
      if (route.request().method() === 'HEAD') {
        await route.fulfill({
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(body.byteLength),
            'accept-ranges': 'bytes',
          },
          body: '',
        });
        return;
      }
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'application/octet-stream', 'accept-ranges': 'bytes' },
        body,
      });
    });
    await page.goto('/?sample=torus-ply');
    await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
    await expect(page.locator('#file-name')).toHaveText('torus.ply');
    await expect(page.locator('#problem')).toBeHidden();
    await expect(page.locator('#problem-desc')).not.toContainText('status 200');
  });
});

test('phone width keeps one scrolling row and hides the arrows', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  const block = await page.locator('#empty-samples').boundingBox();
  const open = await page.locator('#empty-open').boundingBox();
  expect(block).not.toBeNull();
  expect(open).not.toBeNull();
  expect(block!.height).toBeLessThan(170);
  expect(open!.y).toBeLessThan(block!.y);
  const ys = await page.locator('.sample-card').evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().y)));
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(2);
  const overflow = await page.locator('.sample-track').evaluate((el) => el.scrollWidth > el.clientWidth + 8);
  expect(overflow).toBe(true);
  await expect(page.locator('.sample-arrow')).toHaveCount(2);
  await expect(page.locator('#sample-prev')).toBeHidden();
  await expect(page.locator('#sample-next')).toBeHidden();
});
