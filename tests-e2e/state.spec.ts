import { expect, test, type Page } from '@playwright/test';

test('back leaves a graphics banner that can retry', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext(type: string, ...rest: unknown[]): unknown;
    };
    const get = proto.getContext;
    proto.getContext = function (type: string, ...rest: unknown[]) {
      const allow = (window as unknown as { __allowWebgl2?: boolean }).__allowWebgl2;
      return type === 'webgl2' && !allow ? null : get.call(this, type, ...rest);
    };
  });

  await page.goto('/');
  await expect(page.locator('#problem-title')).toHaveText('Graphics are not available');
  await page.click('#problem-close');
  await expect(page.locator('#empty')).toBeVisible();
  await expect(page.locator('#graphics-banner')).toBeVisible();
  await expect(page.locator('#graphics-banner')).toContainText('Graphics are unavailable, so the 3D view is off.');
  await expect(page.locator('#toolbar')).toBeHidden();

  await page.click('#graphics-banner-details');
  await expect(page.locator('#problem-title')).toHaveText('Graphics are not available');
  await expect(page.locator('#graphics-banner')).toBeHidden();

  await page.click('#problem-close');
  await expect(page.locator('#graphics-banner')).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __allowWebgl2?: boolean }).__allowWebgl2 = true;
  });
  await page.click('#graphics-banner-retry');
  await expect(page.locator('#graphics-banner')).toBeHidden();
  await expect(page.locator('#toolbar')).toBeVisible();
  await expect(page.locator('#problem')).toBeHidden();
  expect(errors).toEqual([]);
});

test('scene controls stay off until a scene is open', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#empty')).toBeVisible();

  for (const id of ['#focus-btn', '#reset-btn', '#upright-btn']) {
    await expect(page.locator(id)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator(id)).toHaveAttribute('title', 'Open a scene first');
    await expect(page.locator(id)).toHaveClass(/is-disabled/);
  }

  await page.click('#focus-btn');
  await expect(page.locator('#toast-msg')).toHaveText('Open a scene first');
  await page.click('#reset-btn');
  await expect(page.locator('#toast-msg')).toHaveText('Open a scene first');
  await page.click('#upright-btn');
  await expect(page.locator('#toast-msg')).toHaveText('Open a scene first');
  await expect(page.locator('#upright')).toBeHidden();
  await page.keyboard.press('r');
  await expect(page.locator('#toast-msg')).toHaveText('Open a scene first');
  await page.keyboard.press('f');
  await expect(page.locator('#toast-msg')).toHaveText('Open a scene first');
  await expect(page.locator('#upright')).toBeHidden();

  await page.click('#panel-btn');
  await expect(page.locator('#display-empty-hint')).toBeVisible();
  await expect(page.locator('#display-empty-hint')).toHaveText('Open a scene first');
  await expect(page.locator('#point-size')).toBeDisabled();
  await expect(page.locator('#shading')).toBeDisabled();
  await expect(page.locator('#wireframe')).toBeDisabled();
  await expect(page.locator('[data-applies="points"]')).toHaveAttribute('title', 'Open a scene first');
  await expect(page.locator('#grid')).toBeEnabled();
  await expect(page.locator('#theme-btn')).toBeEnabled();
  await expect(page.locator('#quality-auto')).toBeEnabled();
  await expect(page.locator('#quality-quality')).toBeEnabled();
  await expect(page.locator('#quality-memory')).toBeEnabled();
  for (const id of ['#sh-degree', '#splat-scale', '#lod-scale', '#gs-2d', '#sort-radial', '#extended']) {
    await expect(page.locator(id)).toBeEnabled();
  }
  await page.locator('#sec-view summary').click();
  await page.click('#upright-open');
  await expect(page.locator('#toast-msg')).toHaveText('Open a scene first');
  await expect(page.locator('#upright')).toBeHidden();
});

test('controls follow the loaded kind', async ({ page }) => {
  await page.goto('/?sample=crate');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#focus-btn')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#focus-btn')).toHaveAttribute('title', 'Focus the center (F)');
  await expect(page.locator('#reset-btn')).toBeEnabled();
  await expect(page.locator('#reset-btn')).toHaveAttribute('title', 'Reset view (R)');
  await expect(page.locator('#upright-btn')).toHaveAttribute('title', 'Make upright');
  await page.click('#panel-btn');
  await page.locator('#sec-advanced summary').click();
  await expect(page.locator('#display-empty-hint')).toBeHidden();
  await expect(page.locator('#point-size')).toBeHidden();
  await expect(page.locator('#sh-degree')).toBeHidden();
  await expect(page.locator('#splat-scale')).toBeHidden();
  await expect(page.locator('#lod-scale')).toBeHidden();
  await expect(page.locator('#gs-2d')).toBeHidden();
  await expect(page.locator('#sort-radial')).toBeHidden();
  await expect(page.locator('#extended')).toBeHidden();
  await expect(page.locator('#shading')).toBeVisible();
  await expect(page.locator('#wireframe')).toBeVisible();
  await expect(page.locator('#grid')).toBeEnabled();
  await openPerformance(page);
  await expect(page.locator('#perf-info')).toContainText('Backend');
  await expect(page.locator('#perf-info dt', { hasText: /^Sort$/ })).toHaveCount(0);
  await expect(page.locator('#perf-info dt', { hasText: /^Active splats$/ })).toHaveCount(0);

  await page.goto('/?sample=torus-ply');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await page.click('#panel-btn');
  await page.locator('#sec-advanced summary').click();
  await expect(page.locator('#shading')).toBeHidden();
  await expect(page.locator('#wireframe')).toBeHidden();
  await expect(page.locator('#sh-degree')).toBeVisible();
  await expect(page.locator('#point-size')).toBeHidden();
});

async function openPerformance(page: Page): Promise<void> {
  const section = page.locator('#sec-perf');
  if ((await section.getAttribute('open')) == null) await section.locator('summary').click();
}
