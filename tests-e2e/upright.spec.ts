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

test('clicking the ground of a level slab reports already level', async ({ page }) => {
  await page.goto('/?demo=slab&n=50000');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  // SwiftShader warns on every fresh load. That toast sits on the canvas center.
  const toastClose = page.locator('#toast-close');
  if (await toastClose.isVisible()) await toastClose.click();
  await page.click('#upright-btn');
  await page.click('#upright-level');
  await expect(page.locator('#upright-level')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#view').click();
  await expect(page.locator('#toast-msg')).toHaveText('Already level.');
});
