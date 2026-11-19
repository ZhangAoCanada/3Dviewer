import { expect, test } from './test';

for (const mode of ['on', 'off', 'desktop-resize']) {
  test(`empty heading owns its overlay space; scene HUD preference ${mode}`, async ({ page }, info) => {
    await page.setViewportSize(mode === 'desktop-resize' ? { width: 1280, height: 800 } : { width: 360, height: 420 });
    if (mode !== 'desktop-resize') await page.addInitScript((pref) => localStorage.setItem('3dviewer-hud', pref), mode);
    await page.goto('/');
    await expect(page.locator('#empty')).toBeVisible();
    if (mode === 'desktop-resize') await page.setViewportSize({ width: 360, height: 420 });
    await expect(page.locator('#empty-title')).toBeInViewport({ ratio: 1 });
    const heading = await page.locator('#empty-title').evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return [rect.left + 1, rect.left + rect.width / 2, rect.right - 1].map((x) => ({
        x, y: rect.top + rect.height / 2,
        hit: document.elementFromPoint(x, rect.top + rect.height / 2)?.closest('[id]')?.id,
      }));
    });
    await info.attach('initial-heading-hit-test', { body: JSON.stringify(heading, null, 2), contentType: 'application/json' });
    await page.screenshot({ path: info.outputPath('initial-heading.png') });
    expect(heading.map(point => point.hit)).toEqual(['empty-title', 'empty-title', 'empty-title']);
    await expect(page.locator('#hud')).toBeHidden();
    expect(await page.locator('#empty .empty-card').evaluate(element => element.scrollTop)).toBe(0);
    const crate = page.locator('#empty [data-sample="crate"]');
    await crate.scrollIntoViewIfNeeded();
    await crate.click();
    await expect(page.locator('#file-name')).toHaveText('crate.glb');
    await expect(page.locator('#empty')).toBeHidden();
    if (mode === 'off') {
      await expect(page.locator('#hud')).toBeHidden();
    } else {
      await expect(page.locator('#hud')).toBeVisible();
      await expect(page.locator('#hud-summary-count')).toContainText('tris');
      await page.locator('#hud-toggle').click();
      await expect(page.locator('#hud-detail')).toBeVisible();
      await expect(page.locator('#hud-toggle')).toHaveAttribute('aria-expanded', 'true');
    }
    await page.screenshot({ path: info.outputPath('loaded-scene.png') });
  });
}
