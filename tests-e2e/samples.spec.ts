import { expect, test } from '@playwright/test';

test('start screen sample cards show a type, a size, and a thumbnail', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  const cards = page.locator('.sample-card');
  await expect(cards).toHaveCount(6);
  await expect(cards.locator('.badge')).toHaveText(['Splats', 'Splats', 'Points', 'Mesh', 'Mesh', 'Splats']);
  await expect(cards.nth(0)).toContainText('.ply');
  await expect(cards.nth(0)).toContainText(/\d/);
  await expect(cards.nth(2)).toContainText('.ply');
  await expect(cards.filter({ hasText: 'Butterfly' })).toContainText('Remote');
  await expect(cards.filter({ hasText: 'Remote' })).toHaveCount(1);

  await expect
    .poll(async () =>
      page.locator('.sample-card img').evaluateAll((imgs) =>
        imgs.every((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0),
      ),
    )
    .toBe(true);
  await expect(page.locator('.sample-card img')).toHaveCount(5);

  await page.click('#empty-sample');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#file-name')).toHaveText('torus.ply');
});

test('a missing thumbnail keeps the icon and the card size', async ({ page }) => {
  await page.route('**/*.webp', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.sample-card')).toHaveCount(6);
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
    expect(thumb.height).toBeGreaterThanOrEqual(70);
    expect(thumb.height).toBeLessThanOrEqual(74);
  }
});

test('phone width fits three sample cards on the first row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  const xs = await page.locator('.sample-card').evaluateAll((nodes) =>
    nodes.slice(0, 3).map((node) => Math.round(node.getBoundingClientRect().x)),
  );
  expect(new Set(xs).size).toBe(3);
});
