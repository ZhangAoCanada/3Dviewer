import { expect, type Page } from './test';

/** Release Fly/Game canvas capture so later toolbar clicks reach the UI. */
export async function releaseFlyLook(page: Page): Promise<void> {
  const locked = await page.evaluate(() => document.pointerLockElement?.id === 'view');
  if (!locked) return;
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
}
