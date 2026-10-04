import { expect, test } from '@playwright/test';

test('quarter turns undo, survive a reload, and reset', async ({ page }) => {
  await page.goto('/?sample=torus-ply');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await page.click('#panel-btn');
  await expect(page.locator('#scene-info')).toBeVisible();

  await page.click('#upright-btn');
  await expect(page.locator('#upright')).toBeVisible();
  await page.click('#upright-x-cw');
  await expect(page.locator('#scene-info')).toContainText('Turned 90°');

  await page.click('#upright-undo');
  await expect(page.locator('#scene-info')).toContainText('As in file');
  await expect(page.locator('#scene-info')).not.toContainText('Turned 90°');

  await page.click('#upright-x-cw');
  await page.reload();
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#scene-info')).toContainText('Turned 90°');
  await expect(page.locator('#toast-msg')).toHaveText('Restored your upright setting for this file.');

  await page.click('#toast-action');
  await expect(page.locator('#scene-info')).toContainText('As in file');
  await expect(page.locator('#scene-info')).not.toContainText('Turned 90°');
});

test('outside pointer closes Make upright after an axis turn', async ({ page }) => {
  await page.goto('/?sample=torus-ply');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });

  await page.evaluate(() => {
    const canvas = document.querySelector('#view');
    if (!canvas) throw new Error('missing view');
    let count = 0;
    canvas.addEventListener('pointerdown', () => {
      count += 1;
    });
    Object.defineProperty(window, '__viewPointerDowns', { configurable: true, get: () => count });
  });

  const panel = page.locator('#upright');
  await page.click('#upright-btn');
  await expect(panel).toBeVisible();

  // Axis controls are inside the panel, so the turn must not dismiss it.
  await page.click('#upright-x-cw');
  await expect(panel).toBeVisible();
  await expect(page.locator('#upright-status')).toContainText('Turned 90°');

  const view = page.locator('#view');
  const box = await view.boundingBox();
  expect(box).not.toBeNull();
  const point = { x: box!.width / 2, y: box!.height * 0.25 };
  await view.click({ position: point });
  await expect(panel).toBeHidden();
  await expect(page.locator('#upright-btn')).toHaveAttribute('aria-expanded', 'false');
  expect(await page.evaluate(() => (window as unknown as { __viewPointerDowns: number }).__viewPointerDowns)).toBeGreaterThan(0);

  // A drag on the canvas still orbits, and the closed panel stays closed.
  const x = box!.x + point.x;
  const y = box!.y + point.y;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 56, y + 36, { steps: 6 });
  await page.mouse.up();
  await expect(panel).toBeHidden();

  await page.click('#upright-btn');
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.locator('#upright-btn')).toBeFocused();
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('tapping the canvas after an axis turn closes Make upright', async ({ page }) => {
    await page.goto('/?sample=torus-ply');
    await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
    const panel = page.locator('#upright');
    await page.tap('#upright-btn');
    await expect(panel).toBeVisible();
    await page.tap('#upright-z-cw');
    await expect(panel).toBeVisible();
    await expect(page.locator('#upright-status')).toContainText('Turned 90°');

    const view = page.locator('#view');
    const box = await view.boundingBox();
    expect(box).not.toBeNull();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height * 0.25);
    await expect(panel).toBeHidden();
    await expect(page.locator('#upright-btn')).toHaveAttribute('aria-expanded', 'false');
  });
});

test('clicking the ground of a level slab reports already level', async ({ page }) => {
  await page.goto('/?demo=slab&n=50000');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  // SwiftShader warns on every fresh load. That toast sits on the canvas center.
  // It can hide itself after isVisible() and before the click, and a click waits
  // for the rest of the test. Dismiss it, then hide it if the button is already gone.
  const toastClose = page.locator('#toast-close');
  if (await toastClose.isVisible()) await toastClose.click({ timeout: 2_000 }).catch(() => undefined);
  await page.locator('#toast').evaluate((node) => {
    node.hidden = true;
  });
  await page.click('#upright-btn');
  await page.click('#upright-level');
  await expect(page.locator('#upright-level')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#view').click();
  await expect(page.locator('#toast-msg')).toHaveText('Already level.');
});
