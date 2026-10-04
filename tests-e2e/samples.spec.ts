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
