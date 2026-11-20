import { expect, test } from './test';

const api = 'https://api.github.com/repos/ZhangAoCanada/3Dviewer/releases/latest';

test('returning fresh old cache revalidates and updates an already-open Download dialog without clearing preferences', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('3dviewer-release', JSON.stringify({ tag: 'v0.3.2', at: Date.now() }));
    localStorage.setItem('3dviewer-theme', 'light');
    localStorage.setItem('3dviewer-sensitivity', '1.5');
  });
  let hits = 0;
  let respond = () => {};
  const response = new Promise<void>((resolve) => { respond = resolve; });
  await page.route(api, async (route) => {
    hits += 1;
    await response;
    await route.fulfill({ json: { tag_name: 'v0.3.3', draft: false, prerelease: false } });
  });
  try {
    await page.goto('/');
    await expect(page.locator('#download-version')).toHaveText('v0.3.2');
    await expect.poll(() => hits).toBe(1);
    await page.click('#download-btn');
    await expect(page.locator('#download-dialog-version')).toHaveText('v0.3.2');
    await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
    expect(hits).toBe(1);
    respond();
    for (const id of ['download-version', 'download-menu-version', 'download-dialog-version']) {
      await expect(page.locator(`#${id}`)).toHaveText('v0.3.3');
    }
    expect(await page.evaluate(() => localStorage.getItem('3dviewer-theme'))).toBe('light');
    expect(await page.evaluate(() => localStorage.getItem('3dviewer-sensitivity'))).toBe('1.5');
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('3dviewer-release') ?? '{}').tag)).toBe('v0.3.3');
    expect(hits).toBe(1);
  } finally {
    respond();
  }
});


test('an already-open tab refreshes on return after cooldown and keeps an open dialog current', async ({ page }) => {
  const start = new Date('2026-11-20T11:00:00Z');
  await page.clock.install({ time: start });
  let hits = 0;
  await page.route(api, (route) => route.fulfill({ json: { tag_name: ++hits === 1 ? 'v0.3.2' : 'v0.3.3' } }));
  await page.goto('/');
  await expect(page.locator('#download-version')).toHaveText('v0.3.2');
  await page.click('#download-btn');
  expect(hits).toBe(1);
  await page.clock.setSystemTime(new Date(start.getTime() + 61_000));
  await page.evaluate(() => {
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('online'));
  });
  await expect(page.locator('#download-dialog-version')).toHaveText('v0.3.3');
  await expect(page.locator('#download-version')).toHaveText('v0.3.3');
  expect(hits).toBe(2);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  expect(hits).toBe(2);
});

test('a future cached version cannot override the actual desktop release', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('3dviewer-release', JSON.stringify({ tag: 'v99.0.0', at: Date.now() + 86_400_000 })));
  await page.route(api, (route) => route.fulfill({ json: { tag_name: 'v0.3.2' } }));
  await page.goto('/');
  await expect(page.locator('#download-version')).toHaveText('v0.3.2');
  await expect(page.locator('#download-version')).toHaveAttribute('data-release-state', 'current');
});

test('rate-limited cached metadata is honest, does not overflow phone UI, and recovers on a later event', async ({ page }) => {
  const start = new Date('2026-11-20T11:00:00Z');
  await page.clock.install({ time: start });
  await page.setViewportSize({ width: 360, height: 420 });
  await page.addInitScript(() => {
    localStorage.setItem('3dviewer-release', JSON.stringify({ tag: 'v0.3.2', at: Date.now() }));
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (typeof input === 'string' && input.endsWith('/releases/latest')) {
        const root = document.documentElement;
        root.dataset.releaseFetches = String(Number(root.dataset.releaseFetches ?? 0) + 1);
      }
      return fetch(input, init);
    };
  });
  let hits = 0;
  await page.route(api, (route) => ++hits === 1
    ? route.fulfill({ status: 429, headers: { 'Retry-After': '120', 'Access-Control-Expose-Headers': 'Retry-After' }, body: '{}' })
    : route.fulfill({ json: { tag_name: 'v0.3.3' } }));
  await page.goto('/');
  await expect(page.locator('#download-menu-version')).toHaveText('v0.3.2 (cached)');
  await page.clock.setSystemTime(new Date(start.getTime() + 61_000));
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('html')).toHaveAttribute('data-release-fetches', '1');
  expect(hits).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.clock.setSystemTime(new Date(start.getTime() + 121_000));
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.locator('#download-menu-version')).toHaveText('v0.3.3');
  expect(hits).toBe(2);
});
