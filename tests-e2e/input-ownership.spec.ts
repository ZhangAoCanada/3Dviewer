import { expect, test } from '@playwright/test';

test('Fly leaves Space activation and menu arrows to focused controls', async ({ page }) => {
  await page.goto('/?sample=crate');
  await expect(page.locator('#file-name')).toHaveText('crate.glb');
  await page.click('#mode-fly');
  await expect(page.locator('#view')).toBeFocused();
  await page.click('#help-btn');
  const close = page.locator('#help-dialog').getByRole('button', { name: 'Close', exact: true });
  await close.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#help-dialog')).toBeHidden();
  await page.click('#samples-btn');
  const items = page.locator('#samples-menu [role="menuitem"]');
  await expect(items.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#samples-menu')).toBeHidden();
  await expect(page.locator('#samples-btn')).toBeFocused();
});
