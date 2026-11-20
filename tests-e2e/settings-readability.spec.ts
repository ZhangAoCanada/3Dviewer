import { expect, test } from './test';

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} Settings has the approved hierarchy, readable type and measured text contrast`, async ({ page }, testInfo) => {
    await page.addInitScript((value) => localStorage.setItem('3dviewer-theme', value), theme);
    await page.goto('/?sample=crate');
    await expect(page.locator('#loading')).toBeHidden();await page.click('#panel-btn');
    const headings = await page.locator('.panel-body > details.sec > summary').allTextContents();
    expect(headings.map((x) => x.trim())).toEqual(['Quality & display', 'View and navigation', 'Advanced', 'Scene & diagnostics']);
    await expect(page.locator('#sec-advanced')).toHaveJSProperty('open', false);
    await expect(page.locator('#sec-scene')).toHaveJSProperty('open', false);
    expect((await page.locator('#panel').boundingBox())?.width).toBeCloseTo(400, 1);
    for (const section of ['#sec-view', '#sec-advanced', '#sec-scene', '#sec-perf', '#sec-about', '#quality-details', '#sec-advanced .sec-details']) await page.locator(`${section} > summary`).click();
    const samples = await page.evaluate(() => {
      const rgb = (value: string): number[] => (value.match(/[\d.]+/g) ?? []).map(Number);
      const mix = (fg: number[], bg: number[]) => { const a = fg[3] ?? 1;return fg.slice(0, 3).map((v, i) => v * a + bg[i] * (1 - a)); };
      const luminance = (color: number[]) => color.slice(0, 3).reduce((sum, v, i) => { const s = v / 255;return sum + [0.2126, 0.7152, 0.0722][i] * (s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4); }, 0);
      return [...document.querySelectorAll<HTMLElement>('#panel .hint, #panel label > span:first-child, #panel summary, #panel .seg strong, #panel .kv dt, #panel .kv dd')].filter((el) => el.getClientRects().length && !el.closest('.is-disabled')).map((el) => {
        const ancestors: HTMLElement[] = [];let parent: HTMLElement | null = el;
        while (parent) { ancestors.unshift(parent);parent = parent.parentElement; }
        let bg = [0, 0, 0];for (const a of ancestors) bg = mix(rgb(getComputedStyle(a).backgroundColor), bg);
        const style = getComputedStyle(el);const fg = mix(rgb(style.color), bg);
        const a = luminance(fg), b = luminance(bg);
        return { text: (el.textContent ?? '').trim().slice(0, 90), fontSize: parseFloat(style.fontSize), ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
      });
    });
    expect(samples.length).toBeGreaterThan(8);
    for (const sample of samples) { expect(sample.fontSize, sample.text).toBeGreaterThanOrEqual(13);expect(sample.ratio, sample.text).toBeGreaterThanOrEqual(4.5); }
    await testInfo.attach(`settings-${theme}-contrast`, { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
    await expect(page.locator('#quality-loaded-label')).toHaveText('Mesh loaded');
    await expect(page.locator('#source-detail')).toBeHidden();
    await page.click('#quality-memory');await expect(page.locator('#quality-reopen')).toBeHidden();
    await expect(page.locator('#quality-loaded-label')).toHaveText('Mesh loaded');
  });
}

for (const hasTouch of [false, true]) {
  test.describe(`short narrow ${hasTouch ? 'coarse' : 'fine'} pointer`, () => {
    test.use({ viewport: { width: 360, height: 420 }, hasTouch });
    test('Settings uses near-full width, vertical choices and reachable controls without horizontal overflow', async ({ page }) => {
      await page.goto('/?sample=torus-ply');await expect(page.locator('#loading')).toBeHidden();
      await page.click('#panel-btn');
      // This project deliberately uses SwiftShader; the real software warning must not overlay Settings.
      await expect(page.locator('#settings-notice-slot #toast')).toBeVisible();
      const notice = await page.locator('#settings-notice-slot').boundingBox();
      const body = await page.locator('.panel-body').boundingBox();
      expect((notice?.y ?? 0) + (notice?.height ?? 0)).toBeLessThanOrEqual((body?.y ?? 0) + 1);
      const panel = await page.locator('#panel').boundingBox();
      expect(panel?.width).toBeGreaterThanOrEqual(340);expect(panel?.height).toBeGreaterThanOrEqual(390);
      const choices = await page.locator('#quality-field [role=radio]').all();
      let previousBottom = 0;
      for (const choice of choices) { const box = await choice.boundingBox();expect(box?.width).toBeGreaterThanOrEqual(300);expect(box?.y).toBeGreaterThanOrEqual(previousBottom);previousBottom = (box?.y ?? 0) + (box?.height ?? 0); }
      await page.locator('#quality-memory').click();
      await expect(page.locator('#quality-reopen')).toBeInViewport();
      await expect(page.locator('#quality-loaded-label')).toHaveText('Reduced detail');
      await page.locator('#sec-advanced > summary').click();
      await page.locator('#extended').scrollIntoViewIfNeeded();await expect(page.locator('#extended')).toBeInViewport();
      const widths = await page.locator('.panel-body').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1);
      await page.locator('#panel-close').click();await expect(page.locator('#panel-btn')).toBeFocused();
      await page.click('#panel-btn');await page.locator('#quality-memory').focus();await page.keyboard.press('Escape');
      await expect(page.locator('#panel')).toHaveClass(/is-collapsed/);await expect(page.locator('#panel-btn')).toBeFocused();
    });
  });
}

test('640x400 zoom-equivalent reflow stays reachable; not a claim of actual browser zoom', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 400 });await page.goto('/?sample=crate');
  await expect(page.locator('#loading')).toBeHidden();await page.click('#panel-btn');
  await page.locator('#sec-view > summary').click();await page.locator('#sensitivity').scrollIntoViewIfNeeded();
  await expect(page.locator('#sensitivity')).toBeInViewport();
  await page.locator('#settings-theme').scrollIntoViewIfNeeded();await expect(page.locator('#settings-theme')).toBeInViewport();
  expect(await page.locator('.panel-body').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.click('#panel-close');await expect(page.locator('#panel-btn')).toBeFocused();
});

test('changing center precision requests a real reload even without changing preset identity', async ({ page }) => {
  await page.goto('/?sample=torus-ply');await expect(page.locator('#loading')).toBeHidden();await page.click('#panel-btn');
  await page.locator('#sec-advanced > summary').click();await page.check('#extended');
  await expect(page.locator('#quality-reopen')).toBeVisible();await page.click('#quality-reopen');
  await expect(page.locator('#loading')).toBeHidden();await expect(page.locator('#quality-reopen')).toBeHidden();
  await expect(page.locator('#scene-info')).toContainText('float32 centers');
});


test('short narrow full-detail consent keeps safe default focus, Escape cancel and explicit confirmation reachable', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 420 });
  await page.goto('/?sample=torus-ply');await expect(page.locator('#loading')).toBeHidden();await page.click('#panel-btn');
  await page.click('#source-detail');
  const safe = page.getByRole('button', { name: 'Keep automatic safeguards', exact: true });
  await expect(safe).toBeFocused();await expect(page.locator('#source-detail')).not.toBeChecked();
  await expect(page.locator('#source-detail-title')).toBeInViewport();await expect(page.locator('#source-detail-confirm')).toBeInViewport();
  expect(await page.locator('.source-detail-copy').evaluate((el) => el.scrollTop)).toBe(0);
  await page.keyboard.press('Escape');await expect(page.locator('#source-detail-dialog')).not.toBeVisible();
  await expect(page.locator('#source-detail')).not.toBeChecked();await expect(page.locator('#source-detail')).toBeFocused();
  await page.click('#source-detail');await page.locator('#source-detail-confirm').scrollIntoViewIfNeeded();
  await expect(page.locator('#source-detail-confirm')).toBeInViewport();await page.click('#source-detail-confirm');
  await expect(page.locator('#quality-reopen')).toBeInViewport();
  await expect(page.locator('#quality-loaded-label')).not.toHaveText('Full source');
  await expect(page.locator('#file-detail')).toHaveText(/Reopen required/);
});


test('generated scenes have no reloadable source and do not offer a misleading full-source operation', async ({ page }) => {
  await page.goto('/?demo=slab&n=1000');await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#file-name')).toHaveText('synthetic-slab.ply');await page.click('#panel-btn');
  await expect(page.locator('#source-detail')).toBeHidden();
  await page.click('#quality-memory');await expect(page.locator('#quality-reopen')).toBeHidden();
  await expect(page.locator('#file-detail')).not.toHaveText(/Reopen required/);
  await expect(page.locator('#file-name')).toHaveText('synthetic-slab.ply');
});
