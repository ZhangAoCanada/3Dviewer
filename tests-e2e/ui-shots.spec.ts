import { expect, test, type Page } from '@playwright/test';

const enabled = !!process.env.UI_SHOTS;
const out = process.env.UI_SHOTS_DIR ?? 'artifacts/ui';

test.use({
  launchOptions: {
    executablePath: process.env.CHROME_PATH || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
});

const sizes = [
  { name: 'desktop', width: 1280, height: 800, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
];

async function settle(page: Page) {
  await page.waitForFunction(() => document.querySelector('#loading')?.hasAttribute('hidden'), null, { timeout: 110_000 });
  await page.waitForTimeout(800);
}

for (const size of sizes) {
  for (const theme of ['dark', 'light'] as const) {
    test.describe(`${size.name} ${theme}`, () => {
      test.skip(!enabled, 'set UI_SHOTS=1');
      test.use({
        viewport: { width: size.width, height: size.height },
        hasTouch: size.touch,
        isMobile: size.touch,
        deviceScaleFactor: 1,
      });
      test.beforeEach(async ({ page }) => {
        test.setTimeout(120_000);
        await page.addInitScript((t) => {
          localStorage.setItem('3dviewer-theme', t);
          localStorage.setItem('3dviewer-hint', 'seen');
        }, theme);
      });
      const shot = (page: Page, state: string) =>
        page.screenshot({ path: `${out}/${size.name}-${theme}-${state}.png` });

      test('loaded', async ({ page }) => {
        await page.goto('?sample=torus-ply');
        await settle(page);
        await shot(page, 'loaded');
      });
      test('panel', async ({ page }) => {
        await page.goto('?sample=torus-ply');
        await settle(page);
        await page.click('#panel-btn');
        await shot(page, 'panel');
      });
      test('empty-error', async ({ page }) => {
        await page.goto('?url=missing.ply');
        await expect(page.locator('#toast')).toBeVisible({ timeout: 60_000 });
        await shot(page, 'empty-error');
      });
      test('loading', async ({ page }) => {
        await page.goto('?demo=slab&n=1500000');
        await expect(page.locator('#loading')).toBeVisible();
        await page.waitForTimeout(300);
        await shot(page, 'loading');
      });
      test('url-dialog', async ({ page }) => {
        if (size.touch) {
          await page.goto('./');
          await settle(page);
          await page.click('#empty-url');
        } else {
          await page.goto('?sample=torus-ply');
          await settle(page);
          await page.click('#url-btn');
        }
        await expect(page.locator('#url-dialog')).toBeVisible();
        await shot(page, 'url-dialog');
      });
      test('help', async ({ page }) => {
        await page.goto('?sample=torus-ply');
        await settle(page);
        // Phone More → Controls is Batch 3. '?' opens the same dialog at both sizes.
        await page.keyboard.press('Shift+Slash');
        await expect(page.locator('#help-dialog')).toBeVisible();
        await shot(page, 'help');
      });
      if (size.name === 'desktop' && theme === 'dark') {
        test('samples-menu', async ({ page }) => {
          await page.goto('?sample=torus-ply');
          await settle(page);
          await page.click('#samples-btn');
          await expect(page.locator('#samples-menu')).toBeVisible();
          await shot(page, 'samples-menu');
        });
      }
    });
  }
}
