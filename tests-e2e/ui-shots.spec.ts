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
  { name: 'desktop', width: 1280, height: 800, touch: false, full: true },
  { name: 'phone', width: 390, height: 844, touch: true, full: true },
  { name: 'landscape', width: 844, height: 390, touch: true, full: true },
  { name: 'ipad', width: 1024, height: 1366, touch: true, full: false },
];

async function settle(page: Page) {
  await page.waitForFunction(() => document.querySelector('#loading')?.hasAttribute('hidden'), null, { timeout: 110_000 });
  await page.waitForTimeout(800);
}

for (const size of sizes) {
  for (const theme of ['dark', 'light'] as const) {
    test.describe(`${size.name} ${theme}`, () => {
      test.skip(!enabled, 'set UI_SHOTS=1');
      test.skip(size.name === 'ipad' && theme !== 'dark', 'iPad shots are dark only');
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
      const shot = async (page: Page, state: string) => {
        if (state === 'panel' || state.endsWith('menu')) {
          await page.evaluate(() => {
            for (const animation of document.getAnimations()) animation.finish();
          });
        }
        await page.screenshot({ path: `${out}/${size.name}-${theme}-${state}.png` });
      };
      const phone = size.width <= 640;

      test('loaded', async ({ page }) => {
        await page.goto('?sample=torus-ply');
        await settle(page);
        await shot(page, 'loaded');
      });
      test('empty', async ({ page }) => {
        await page.goto('/');
        await settle(page);
        await shot(page, 'empty');
      });
      test('panel', async ({ page }) => {
        await page.goto('?sample=torus-ply');
        await settle(page);
        await page.click('#panel-btn');
        await expect(page.locator('#panel')).toBeVisible();
        await shot(page, 'panel');
      });
      if (!size.full) return;
      test('empty-error', async ({ page }) => {
        await page.goto('?url=missing.ply');
        await expect(page.locator('#problem-title')).toHaveText('Could not download the file', { timeout: 60_000 });
        await shot(page, 'empty-error');
      });
      test('loading', async ({ page }) => {
        // The 1.5M slab finishes before a screenshot can land. Hold #loading open
        // just long enough to capture the card; the app still hides it itself.
        await page.addInitScript(() => {
          const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'hidden');
          if (!desc || !desc.set || !desc.get) return;
          const setHidden = desc.set;
          const getHidden = desc.get;
          Object.defineProperty(HTMLElement.prototype, 'hidden', {
            configurable: true,
            get() {
              return getHidden.call(this);
            },
            set(value) {
              if (this.id === 'nav-hint' && value === false && document.documentElement.dataset.holdHint === '1') return;
              if (this.id === 'loading' && value) {
                document.documentElement.dataset.holdHint = '1';
                window.setTimeout(() => {
                  delete document.documentElement.dataset.holdHint;
                  const card = document.querySelector('#loading');
                  if (card) setHidden.call(card, true);
                }, 4000);
                return;
              }
              setHidden.call(this, value);
            },
          });
        });
        await page.goto('?demo=slab&n=1500000');
        await expect(page.locator('#loading')).toBeVisible();
        await expect(page.locator('#loading-file')).toHaveText('Synthetic drone slab');
        await shot(page, 'loading');
      });
      test('url-dialog', async ({ page }) => {
        await page.goto('?sample=torus-ply');
        await settle(page);
        if (phone) {
          await page.click('#more-btn');
          await page.click('#more-menu [data-action=url]');
        } else {
          await page.click('#url-btn');
        }
        await expect(page.locator('#url-dialog')).toBeVisible();
        await shot(page, 'url-dialog');
      });
      test('help', async ({ page }) => {
        await page.goto('?sample=torus-ply');
        await settle(page);
        if (phone) {
          await page.click('#more-btn');
          await page.click('#more-menu [data-action=help]');
        } else {
          await page.keyboard.press('Shift+Slash');
        }
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
      if (size.name === 'phone' && theme === 'dark') {
        test('more-menu', async ({ page }) => {
          await page.goto('?sample=torus-ply');
          await settle(page);
          await page.click('#more-btn');
          await expect(page.locator('#more-menu')).toBeVisible();
          await shot(page, 'more-menu');
        });
      }
    });
  }
}
