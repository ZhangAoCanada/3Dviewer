import { expect, test, type Locator, type Page } from '@playwright/test';

async function finishAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const animations = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getTiming();
      return timing?.iterations !== Infinity;
    });
    await Promise.all(animations.map((animation) => animation.finished));
  });
}

async function leftEdge(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!.x;
}

test.describe('wide viewport', () => {
  test.use({ viewport: { width: 1600, height: 900 } });

  test('toolbar stays put when settings opens', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
    await page.evaluate(() => {
      const toast = document.querySelector<HTMLElement>('#toast');
      const message = document.querySelector('#toast-msg');
      if (message) message.textContent = 'Settings stay out of the way.';
      if (toast) toast.hidden = false;
    });

    const toolbar = page.locator('#toolbar');
    const hud = page.locator('#hud');
    const toast = page.locator('.toast-stack');
    await expect(toolbar).toBeVisible();
    await expect(hud).toBeVisible();
    await expect(toast).toBeVisible();

    const before = {
      toolbar: await leftEdge(toolbar),
      hud: await leftEdge(hud),
      toast: await leftEdge(toast),
    };
    const toolbarBox = await toolbar.boundingBox();
    expect(toolbarBox).not.toBeNull();
    expect(Math.abs(toolbarBox!.x + toolbarBox!.width / 2 - 800)).toBeLessThan(1);

    await page.click('#panel-btn');
    await expect(page.locator('#panel')).toBeVisible();
    await finishAnimations(page);

    expect(Math.abs((await leftEdge(toolbar)) - before.toolbar)).toBeLessThan(1);
    expect(Math.abs((await leftEdge(hud)) - before.hud)).toBeLessThan(1);
    expect(Math.abs((await leftEdge(toast)) - before.toast)).toBeLessThan(1);

    const openBox = await toolbar.boundingBox();
    expect(openBox).not.toBeNull();
    expect(Math.abs(openBox!.x + openBox!.width / 2 - 800)).toBeLessThan(1);
  });
});

test.describe('narrow desktop', () => {
  test.use({ viewport: { width: 900, height: 700 } });

  test('toolbar shifts just enough to clear the open drawer', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
    const toolbar = page.locator('#toolbar');
    await expect(toolbar).toBeVisible();
    const before = await toolbar.boundingBox();
    expect(before).not.toBeNull();

    await page.click('#panel-btn');
    await expect(page.locator('#panel')).toBeVisible();
    await finishAnimations(page);

    const after = await toolbar.boundingBox();
    const panel = await page.locator('#panel').boundingBox();
    expect(after).not.toBeNull();
    expect(panel).not.toBeNull();
    expect(after!.x).toBeLessThan(before!.x - 1);
    const gap = panel!.x - (after!.x + after!.width);
    expect(gap).toBeGreaterThan(4);
    expect(gap).toBeLessThan(16);
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('bottom sheet does not move the toolbar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
    const toolbar = page.locator('#toolbar');
    await expect(toolbar).toBeVisible();
    const before = await leftEdge(toolbar);
    await page.click('#panel-btn');
    await expect(page.locator('#panel')).toBeVisible();
    await finishAnimations(page);
    expect(Math.abs((await leftEdge(toolbar)) - before)).toBeLessThan(1);
  });
});
