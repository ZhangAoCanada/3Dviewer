import { expect, test } from './test';
import path from 'node:path';

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, 'ready', {
      get: () => new Promise<void>((resolve) => window.addEventListener('test-worker-ready', () => resolve(), { once: true })),
    });
  });
});

for (const choice of ['local file', 'sample'] as const) {
  test(`a ${choice} chosen before worker readiness survives deferred boot`, async ({ page }) => {
    let sceneRequests = 0;
    page.on('request', (request) => { if (request.url().endsWith('/samples/crate.glb')) sceneRequests += 1; });
    await page.goto('/');
    if (choice === 'local file') await page.locator('#file-input').setInputFiles(path.resolve('public/samples/crate.glb'));
    else await page.locator('[data-sample="crate"]').click();
    await expect(page.locator('#file-name')).toHaveText('crate.glb');
    await expect(page.locator('#loading')).toBeHidden();
    const requestsBeforeReady = sceneRequests;
    const loadingRestarts = await page.evaluate(async () => {
      const loading = document.querySelector('#loading');
      if (!loading) throw new Error('Missing loading overlay');
      let restarts = 0;
      const observer = new MutationObserver((records) => {
        restarts += records.filter((record) => record.attributeName === 'hidden' && record.oldValue !== null).length;
      });
      observer.observe(loading, { attributes: true, attributeOldValue: true, attributeFilter: ['hidden'] });
      window.dispatchEvent(new Event('test-worker-ready'));
      await Promise.resolve();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      observer.disconnect();
      return restarts;
    });
    expect(loadingRestarts).toBe(0);
    await expect(page.locator('#empty')).toBeHidden();
    await expect(page.locator('#file-name')).toHaveText('crate.glb');
    await expect(page.locator('#loading')).toBeHidden();
    expect(sceneRequests).toBe(requestsBeforeReady);
  });
}

test('a crash deep link waits for a choice and Dismiss removes the auto-load URL', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('3dviewer-inflight', JSON.stringify({
    name: 'crate.glb', size: null, origin: 'sample', url: '/3Dviewer/samples/crate.glb', at: Date.now(),
  })));
  let sceneRequests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/samples/crate.glb')) sceneRequests += 1; });
  await page.goto('/?sample=crate');
  await expect(page.locator('#problem-title')).toHaveText('Not enough memory for this scene');
  await page.evaluate(async () => {
    window.dispatchEvent(new Event('test-worker-ready'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  await expect(page.locator('#problem')).toBeVisible();
  expect(sceneRequests).toBe(0);
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await expect(page.locator('#empty')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
});

test('Lower memory explicitly retries a blocked crash source', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('3dviewer-inflight', JSON.stringify({
    name: 'crate.glb', size: null, origin: 'sample', url: '/3Dviewer/samples/crate.glb', at: Date.now(),
  })));
  await page.goto('/?sample=crate');
  await expect(page.locator('#problem')).toBeVisible();
  await page.getByRole('button', { name: 'Switch to Lower memory and try again' }).click();
  await expect(page.locator('#file-name')).toHaveText('crate.glb');
  await page.evaluate(() => window.dispatchEvent(new Event('test-worker-ready')));
  await expect(page.locator('#problem')).toBeHidden();
  await expect(page.locator('#empty')).toBeHidden();
});
