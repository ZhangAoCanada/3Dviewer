import { expect, test, type Page, type Request } from '@playwright/test';

const origin = 'http://127.0.0.1:4173/3Dviewer/';

const formats = [
  { name: 'hang.glb' },
  { name: 'hang.gltf', gltf: true },
  { name: 'hang.obj' },
  { name: 'hang.splat' },
  { name: 'gaussian.ply' },
  { name: 'points.ply' },
];

function hangUrl(name: string): string {
  return new URL(name, origin).href;
}

/** One triangle whose external buffer is `scene.bin`. */
function hangingGltf(): string {
  return JSON.stringify({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
      { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 },
    ],
    buffers: [{ uri: 'scene.bin', byteLength: 42 }],
  });
}

function isHung(url: string): boolean {
  return /hang\.(glb|gltf|obj|splat)$/.test(url) || /gaussian\.ply$/.test(url) || /points\.ply$/.test(url) || url.endsWith('/scene.bin');
}

async function armHang(
  page: Page,
  gltf: boolean,
): Promise<{ pendingGets: () => number; pendingBin: () => number; failed: () => string[] }> {
  const pending = new Set<string>();
  const failed: string[] = [];
  const id = (request: Request) => `${request.method()} ${request.url()}`;
  page.on('request', (request) => {
    if (!isHung(request.url())) return;
    pending.add(id(request));
  });
  page.on('requestfinished', (request) => pending.delete(id(request)));
  page.on('requestfailed', (request) => {
    if (!isHung(request.url())) return;
    failed.push(request.url());
    pending.delete(id(request));
  });
  const fulfillHead = (headers: Record<string, string>) => ({
    status: 200,
    headers,
    body: '',
  });
  await page.route('**/*', (route) => {
    const request = route.request();
    if (!isHung(request.url())) return route.continue();
    if (request.method() === 'HEAD') {
      return route.fulfill(
        fulfillHead({
          'content-type': 'application/octet-stream',
          'content-length': '1048576',
          'accept-ranges': 'bytes',
        }),
      );
    }
    if (gltf && request.url().endsWith('.gltf')) {
      return route.fulfill({
        status: 200,
        contentType: 'model/gltf+json',
        body: hangingGltf(),
      });
    }
    return undefined;
  });
  const count = (kind: 'get' | 'bin') =>
    [...pending].filter((item) => (kind === 'bin' ? item.includes('GET ') && item.endsWith('/scene.bin') : item.startsWith('GET '))).length;
  return { pendingGets: () => count('get'), pendingBin: () => count('bin'), failed: () => failed };
}

/** Chromium logs the fetch Cancel aborted. That is the cancelled request, not an app error. */
function appConsoleError(text: string): boolean {
  return !/net::ERR_ABORTED/i.test(text);
}

for (const format of formats) {
  test(`cancel stops a hanging ${format.name}`, async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    const track = await armHang(page, format.gltf === true);
    await page.goto(`/?url=${encodeURIComponent(hangUrl(format.name))}`);
    await expect(page.locator('#loading')).toBeVisible();
    if (format.gltf) await expect.poll(() => track.pendingBin(), { timeout: 15_000 }).toBeGreaterThan(0);
    else await expect.poll(() => track.pendingGets(), { timeout: 15_000 }).toBeGreaterThan(0);
    await page.click('#loading-cancel');
    await expect(page.locator('#loading')).toBeHidden({ timeout: 250 });
    await expect.poll(() => (format.gltf ? track.pendingBin() : track.pendingGets()), { timeout: 1_000 }).toBe(0);
    expect(track.failed().length).toBeGreaterThan(0);
    await expect(page.locator('body')).toHaveAttribute('data-loads', '0', { timeout: 1_000 });
    expect(pageErrors).toEqual([]);
    expect(consoleErrors.filter(appConsoleError)).toEqual([]);
    await page.goto('about:blank');
  });
}

async function gpuObjects(page: Page): Promise<string> {
  const panel = page.locator('#panel');
  if (await panel.evaluate((node) => node.classList.contains('is-collapsed'))) {
    await page.click('#panel-btn');
  }
  const row = page.locator('#perf-info dt', { hasText: 'GPU objects' });
  await expect(row).toBeVisible();
  return row.locator('xpath=following-sibling::dd[1]').innerText();
}

test('cancelled gltf loads do not leak a crate', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const baseline = await page.context().newPage();
  try {
    await baseline.goto('/?sample=crate');
    await expect(baseline.locator('#hud-tris')).toHaveText('12', { timeout: 30_000 });
    const fresh = await gpuObjects(baseline);

    await page.goto('/');
    await expect(page.locator('#loading')).toBeHidden();
    await page.route('**/hang.gltf', (route) => {
      if (route.request().method() === 'HEAD') {
        return route.fulfill({ status: 200, headers: { 'content-length': '128' }, body: '' });
      }
      return route.fulfill({ status: 200, contentType: 'model/gltf+json', body: hangingGltf() });
    });
    await page.route('**/scene.bin', () => undefined);
    const url = hangUrl('hang.gltf');
    for (let round = 0; round < 3; round += 1) {
      const pendingBin = new Set<string>();
      const onRequest = (request: Request) => {
        if (request.method() === 'GET' && request.url().endsWith('/scene.bin')) pendingBin.add(request.url());
      };
      const onDone = (request: Request) => pendingBin.delete(request.url());
      page.on('request', onRequest);
      page.on('requestfinished', onDone);
      page.on('requestfailed', onDone);
      await page.click('#url-btn');
      await page.fill('#url-input', url);
      await page.locator('#url-form button[value="open"]').click();
      await expect(page.locator('#loading')).toBeVisible();
      await expect.poll(() => pendingBin.size, { timeout: 15_000 }).toBeGreaterThan(0);
      await page.click('#loading-cancel');
      page.off('request', onRequest);
      page.off('requestfinished', onDone);
      page.off('requestfailed', onDone);
      await expect(page.locator('#loading')).toBeHidden({ timeout: 1_000 });
      await page.click('#samples-btn');
      await page.locator('#samples-menu').getByRole('menuitem', { name: 'Mesh crate (.glb)' }).click();
      await expect(page.locator('#hud-tris')).toHaveText('12', { timeout: 30_000 });
      await expect(page.locator('#file-name')).toHaveText('crate.glb');
    }
    expect(await gpuObjects(page)).toBe(fresh);
    expect(pageErrors).toEqual([]);
    await page.goto('about:blank');
    await baseline.goto('about:blank');
  } finally {
    await baseline.close();
  }
});
