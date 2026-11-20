import { expect, test } from './test';
const api = 'https://api.github.com/repos/ZhangAoCanada/3Dviewer/releases/latest';
for (const width of [1280, 1920]) for (const theme of ['light', 'dark']) for (const metadata of ['success', 'cached', 'unavailable']) {
  test(`icon-only download ${width} ${theme} ${metadata}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(({ theme, metadata }) => {
      localStorage.setItem('3dviewer-theme', theme);
      if (metadata === 'cached') localStorage.setItem('3dviewer-release', JSON.stringify({ tag: 'v0.3.2', at: Date.now() }));
    }, { theme, metadata });
    await page.route(api, route => metadata === 'success' ? route.fulfill({ json: { tag_name: 'v0.3.3' } }) : route.fulfill({ status: 503, body: '{}' }));
    await page.goto('/');
    const button = page.locator('#download-btn');
    await expect(page.locator('#download-version')).toHaveAttribute('data-release-state', metadata === 'success' ? 'current' : metadata);
    await expect(button).toBeVisible();
    await expect(button).toHaveAccessibleName('Download desktop app');
    await expect(button.locator('.btn-label')).toHaveCount(0);
    await expect(button.locator('#download-version')).toBeHidden();
    expect(await button.innerText()).toBe('');
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    if (!box) throw Error('Download button must have a box');
    expect(box.width).toBeGreaterThanOrEqual(34);
    expect(Math.abs(box.width - box.height)).toBeLessThan(1);
    await expect(button).toHaveAttribute('title', metadata === 'success' ? /v0.3.3/ : metadata === 'cached' ? /v0.3.2.*cached/ : /unavailable/);
    await page.locator('#help-btn').focus(); await page.keyboard.press('Tab');
    await expect(button).toBeFocused(); await page.keyboard.press('Enter');
    await expect(page.locator('#download-dialog')).toBeVisible();
    await expect(page.locator('#download-dialog-version')).toHaveText(metadata === 'success' ? 'v0.3.3' : metadata === 'cached' ? 'v0.3.2 (cached)' : '');
    await page.keyboard.press('Escape'); await expect(button).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
for (const theme of ['light', 'dark']) test(`phone download remains a named menu action ${theme}`, async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await page.addInitScript(theme => localStorage.setItem('3dviewer-theme', theme), theme);
  await page.route(api, route => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/'); await expect(page.locator('#download-btn')).toBeHidden();
  await page.click('#more-btn'); await page.getByRole('menuitem', { name: 'Download desktop app', exact: true }).click();
  await expect(page.locator('#download-dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('coarse pointer keeps a useful square download hit target', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, hasTouch: true, baseURL });
  try {
    await context.route(api, route => route.fulfill({ status: 503, body: '{}' }));
    const page = await context.newPage(); await page.goto('/');
    const box = await page.locator('#download-btn').boundingBox();
    if (!box) throw Error('Download button must have a box');
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(box.width - box.height)).toBeLessThan(1);
  } finally { await context.close(); }
});
