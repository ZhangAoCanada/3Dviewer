import { expect, test } from '@playwright/test';

test('forced WebGL2 failure keeps the shell and the problem card', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => {
    const proto = HTMLCanvasElement.prototype as unknown as {
      getContext(type: string, ...rest: unknown[]): unknown;
    };
    const get = proto.getContext;
    proto.getContext = function (type: string, ...rest: unknown[]) {
      return type === 'webgl2' ? null : get.call(this, type, ...rest);
    };
  });

  await page.goto('/');
  await expect(page.locator('#problem-title')).toHaveText('Graphics are not available');
  await expect(page.locator('#problem-actions')).toContainText('Try again');
  await expect(page.locator('#problem-actions')).toContainText('Download desktop app');
  await expect(page.locator('#toolbar')).toBeHidden();

  await page.click('#help-btn');
  await expect(page.locator('#help-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#help-dialog')).toBeHidden();

  await page.click('#download-btn');
  await expect(page.locator('#download-dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.click('#theme-btn');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.click('#url-btn');
  await expect(page.locator('#url-dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  let fileChooser = false;
  page.on('filechooser', () => {
    fileChooser = true;
  });
  await page.click('#problem-close');
  await expect(page.locator('#empty')).toBeVisible();
  await page.click('#empty-open');
  await expect(page.locator('#problem-title')).toHaveText('Graphics are not available');
  expect(fileChooser).toBe(false);

  await page.click('#panel-btn');
  await expect(page.locator('#panel')).not.toHaveClass(/is-collapsed/);

  await page.locator('#problem-details summary').click();
  await expect(page.locator('#problem-report')).toContainText('WebGL2: no');
  await page.click('#problem-copy');
  await expect.poll(async () => page.evaluate(() => navigator.clipboard.readText())).toMatch(/^Omniview/);
  expect(errors).toEqual([]);
});

test.describe('service worker blocked', () => {
  test.use({ serviceWorkers: 'block' });

  test('help opens without waiting for the worker', async ({ page }) => {
    await page.goto('/');
    await page.click('#help-btn');
    await expect(page.locator('#help-dialog')).toBeVisible({ timeout: 2000 });
  });
});

test('a corrupt ply shows the format card', async ({ page }) => {
  await page.route('**/bad.ply', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: 'ply\nformat binary_little_endian 1.0\nelement vertex 1000\nproperty float x\nend_header\n\x00',
    }),
  );
  const target = 'http://127.0.0.1:4173/3Dviewer/bad.ply';
  await page.goto(`?url=${encodeURIComponent(target)}`);
  await expect(page.locator('#problem-title')).toHaveText('This file could not be read', { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Choose another file' })).toBeVisible();
});

test('a failed download can be retried', async ({ page }) => {
  let hits = 0;
  await page.route('**/gone.ply', (route) => {
    hits += 1;
    return route.abort('failed');
  });
  const target = 'http://127.0.0.1:4173/3Dviewer/gone.ply';
  await page.goto(`?url=${encodeURIComponent(target)}`);
  await expect(page.locator('#problem-title')).toHaveText('Could not download the file', { timeout: 30_000 });
  const before = hits;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.poll(() => hits).toBeGreaterThan(before);
});

test('a crash breadcrumb offers a dismissible memory card', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      '3dviewer-inflight',
      JSON.stringify({
        name: 'big-scan.ply',
        size: 2 * 1024 * 1024 * 1024,
        origin: 'file',
        at: Date.now(),
      }),
    );
  });
  await page.goto('/');
  await expect(page.locator('#problem-title')).toHaveText('Not enough memory for this scene');
  await expect(page.locator('#problem-desc')).toContainText('big-scan.ply');
  await expect(page.locator('#problem-desc')).toContainText('ran out of memory');
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.locator('#problem')).toBeHidden();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('3dviewer-inflight'))).toBeNull();
});
