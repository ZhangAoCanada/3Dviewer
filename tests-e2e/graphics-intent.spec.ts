import { expect, test, type Page } from './test';

test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, 'ready', {
      get: () => new Promise<void>((resolve) => window.addEventListener('test-worker-ready', () => resolve(), { once: true })),
    });
    const proto = HTMLCanvasElement.prototype as unknown as { getContext(type: string, ...rest: unknown[]): unknown };
    const get = proto.getContext;
    proto.getContext = function (type: string, ...rest: unknown[]) {
      return type === 'webgl2' && document.documentElement.dataset.allowWebgl2 !== 'yes' ? null : get.call(this, type, ...rest);
    };
  });
});
async function ready(page: Page): Promise<void> {
  await page.evaluate(async () => {
    window.dispatchEvent(new Event('test-worker-ready'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}
async function allowGraphics(page: Page): Promise<void> {
  await page.evaluate(() => { document.documentElement.dataset.allowWebgl2 = 'yes'; });
  await page.locator('#problem-actions').getByRole('button', { name: 'Try again', exact: true }).click();
}
for (const initial of ['', '?sample=sphere']) {
  for (const timing of ['before readiness', 'after readiness']) {
    test(`graphics retry resumes explicit Crate once ${timing}, initial ${initial || 'empty'}`, async ({ page }) => {
      const requested: string[] = [];
      page.on('request', (request) => {
        if (request.method() === 'GET' && /\/samples\/(crate\.glb|sphere\.obj)$/.test(request.url())) requested.push(new URL(request.url()).pathname);
      });
      await page.goto(`/${initial}`);
      await expect(page.locator('#problem-title')).toHaveText('Graphics are not available');
      if (timing === 'after readiness') await ready(page);
      await page.locator('#samples-btn').click();
      await page.locator('#samples-menu').getByRole('menuitem', { name: /crate/i }).click();
      expect(requested).toEqual([]);
      await allowGraphics(page);
      await expect(page.locator('#file-name')).toHaveText('crate.glb');
      if (timing === 'before readiness') await ready(page);
      await expect(page.locator('#problem')).toBeHidden();
      await expect(page.locator('#empty')).toBeHidden();
      expect(requested).toEqual(['/3Dviewer/samples/crate.glb']);
    });
  }
}
test('crash Dismiss survives initial graphics failure and deferred readiness', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('3dviewer-inflight', JSON.stringify({
    name: 'crate.glb', size: null, origin: 'sample', url: '/3Dviewer/samples/crate.glb', at: Date.now(),
  })));
  let sceneRequests = 0;
  page.on('request', (request) => { if (request.url().endsWith('/samples/crate.glb')) sceneRequests += 1; });
  await page.goto('/?sample=crate');
  await expect(page.locator('#problem-title')).toHaveText('Graphics are not available');
  await allowGraphics(page);
  await expect(page.locator('#problem-title')).toHaveText('Not enough memory for this scene');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await ready(page);
  await expect(page.locator('#empty')).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  expect(sceneRequests).toBe(0);
});
