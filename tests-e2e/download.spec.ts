import { expect, test } from '@playwright/test';

const release = 'https://github.com/ZhangAoCanada/3Dviewer/releases/latest';

test('download dialog highlights this computer and links to the latest release', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#download-btn')).toBeVisible();
  await page.click('#download-btn');
  const dialog = page.locator('#download-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(`a[href="${release}"]`)).toHaveCount(4);
  const os = await page.evaluate(() => {
    const ua = navigator.userAgent;
    const platform = navigator.platform;
    if (/Android|iPhone|iPad|iPod/i.test(ua)) return 'other';
    if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
    if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua)) return 'macos';
    if (/Linux/i.test(platform) || /Linux/i.test(ua)) return 'linux';
    return 'other';
  });
  if (os !== 'other') {
    await expect(dialog.locator(`[data-os="${os}"]`)).toHaveClass(/is-current/);
    await expect(dialog.locator(`[data-os="${os}"] .download-badge`)).toBeVisible();
  }
  await expect(dialog.locator('#download-note')).not.toBeEmpty();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('phone More menu includes Download desktop app', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#download-btn')).toBeHidden();
  await page.click('#more-btn');
  await expect(page.locator('#download-menu-item')).toBeVisible();
  await page.click('#download-menu-item');
  await expect(page.locator('#download-dialog')).toBeVisible();
  await expect(page.locator('#download-dialog a[href="https://github.com/ZhangAoCanada/3Dviewer/releases/latest"]')).toHaveCount(4);
});

test('the download entry is hidden inside the desktop app', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {} });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('#download-btn')).toBeHidden();
  await page.click('#more-btn');
  await expect(page.locator('#download-menu-item')).toBeHidden();
  await expect(page.locator('html')).toHaveClass(/is-desktop/);
});
