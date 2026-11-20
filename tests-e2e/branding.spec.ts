import { test, expect } from '@playwright/test';

for (const theme of ['light', 'dark']) for (const width of [1280, 360]) {
  test(`${theme} ${width}px keeps the approved symbol within the verified toolbar`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 360 ? 420 : 800 });
    await page.addInitScript((value) => localStorage.setItem('3dviewer-theme', value), theme);
    await page.goto('./');
    await expect(page.locator('#empty')).toBeVisible();
    await expect(page.locator('#loading')).toBeHidden();
    await expect(page.locator('.brand-name')).toHaveText('Omniview');
    await expect(page.locator('.brand-name')).toBeVisible();
    const geometry = await page.locator('.mark').evaluate((element) => {
      if (!(element instanceof HTMLImageElement)) throw new Error('Brand must be an image');
      const r = element.getBoundingClientRect();
      const brand = element.closest('.brand')?.getBoundingClientRect();
      const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(element, 0, 0, 20, 20);
      return { width: r.width, height: r.height, naturalWidth: element.naturalWidth, centerAlpha: context.getImageData(10, 10, 1, 1).data[3], within: !!brand && r.left >= brand.left && r.right <= brand.right, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(geometry).toEqual({ width: 20, height: 20, naturalWidth: 560, centerAlpha: 0, within: true, overflow: false });
    await page.click('#panel-btn');
    await expect(page.locator('#panel')).not.toHaveClass(/is-collapsed/);
    await page.locator('#panel-close').focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('#panel')).toHaveClass(/is-collapsed/);
  });
}

test('serves the same v5 symbol for favicon and decoded transparent/PWA platform variants', async ({ page, request }) => {
  await page.goto('./');
  const logo = await request.get('logo.svg'), favicon = await request.get('favicon.svg');
  expect(logo.ok()).toBe(true); expect(favicon.ok()).toBe(true);
  expect((await logo.body()).equals(await favicon.body())).toBe(true);
  const svg = await logo.text();
  expect(svg.match(/<ellipse /g)).toHaveLength(7);
  expect(svg).toContain('viewBox="232 142 560 560"');
  expect(svg).not.toContain('fill="white"');
  const manifest = await request.get('manifest.webmanifest'); expect(manifest.ok()).toBe(true);
  expect(await manifest.json()).toMatchObject({ name: 'Omniview', icons: expect.arrayContaining([expect.objectContaining({ src: 'icon-512-maskable.png', purpose: 'maskable' })]) });
  const decoded = await page.evaluate(async () => {
    const output = [];
    for (const name of ['favicon-32.png', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', 'icon-512-maskable.png']) {
      const image = new Image(); image.src = name; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas unavailable');
      context.drawImage(image, 0, 0);
      output.push({ name, width: image.width, height: image.height, cornerAlpha: context.getImageData(0, 0, 1, 1).data[3], centerAlpha: context.getImageData(image.width / 2, image.height / 2, 1, 1).data[3] });
    }
    return output;
  });
  expect(decoded).toEqual([
    { name: 'favicon-32.png', width: 32, height: 32, cornerAlpha: 0, centerAlpha: 0 },
    { name: 'icon-192.png', width: 192, height: 192, cornerAlpha: 0, centerAlpha: 0 },
    { name: 'icon-512.png', width: 512, height: 512, cornerAlpha: 0, centerAlpha: 0 },
    { name: 'apple-touch-icon.png', width: 180, height: 180, cornerAlpha: 255, centerAlpha: 255 },
    { name: 'icon-512-maskable.png', width: 512, height: 512, cornerAlpha: 255, centerAlpha: 255 },
  ]);
});
