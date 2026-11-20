import { expect, test, type Page } from './test';
import { gaussianPlyFixture } from '../tests/fixtures/gaussianPlyFixture';

test.use({ serviceWorkers: 'block' });
async function settings(page: Page): Promise<void> {
  if (await page.locator('#panel').evaluate((el) => el.classList.contains('is-collapsed'))) await page.click('#panel-btn');
}
async function enable(page: Page): Promise<void> {
  await settings(page);await page.click('#source-detail');
  await expect(page.locator('#source-detail-dialog')).toBeVisible();
  await expect(page.locator('#source-detail-risk')).toContainText('Available VRAM is unknown');
  await page.click('#source-detail-confirm');
  await expect(page.locator('#source-detail')).toBeChecked();
}
async function file(page: Page, degree: 0 | 1 | 2 | 3 | 4 = 3): Promise<void> {
  await page.goto('/?sh=2');
  await page.locator('#file-input').setInputFiles({ name: `source-sh${degree}.ply`, mimeType: 'application/octet-stream', buffer: gaussianPlyFixture({ degree }) });
  await expect(page.locator('#hud-splats')).toHaveText('8');
  await expect(page.locator('#loading')).toBeHidden();
}

test('risk consent is explicit; pending is not mislabeled full; actual reopen loads source SH3', async ({ page }) => {
  await file(page);await settings(page);
  await expect(page.locator('#file-detail')).toHaveAttribute('title', /SH 2 of 3/);
  await page.click('#source-detail');
  await page.getByRole('button', { name: 'Keep automatic safeguards', exact: true }).click();
  await expect(page.locator('#source-detail')).not.toBeChecked();
  await expect(page.locator('#quality-reopen')).toBeHidden();
  await enable(page);
  await expect(page.locator('#file-detail')).toHaveText(/Reopen required/);
  await expect(page.locator('#scene-info')).toContainText('2 of 3');
  await page.click('#quality-reopen');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#scene-info')).toContainText('3 of 3');
  await expect(page.locator('#scene-info')).toContainText('float32 centers');
  await expect(page.locator('#file-detail')).toHaveText(/Full source/);
  await expect(page.locator('#file-detail')).toHaveAttribute('title', /not lossless precision/);
  await expect(page.locator('#hud-splats')).toHaveText('8');
  await expect(page.locator('#quality-reopen')).toBeHidden();
  await page.reload();
  await expect(page.locator('#source-detail')).not.toBeChecked();
});

for (const mode of ['full', 'memory'] as const) {
  test(`canceling a ${mode} quality reopen keeps the previous actual scene; stale work cannot replace it`, async ({ page }) => {
    const bytes = gaussianPlyFixture();let hold = false;let held = false;
    let release = () => {};const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route('**/delayed-sh3.ply', async (route) => {
      const req = route.request();
      if (req.method() === 'GET' && !req.headers().range && hold) { held = true;await gate; }
      await route.fulfill({ status: 200, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) }, body: req.method() === 'HEAD' ? undefined : bytes });
    });
    try {
      await page.goto('/?sh=2');
      await page.click('#url-btn');
      await page.fill('#url-input', new URL('delayed-sh3.ply', page.url()).href);
      await page.locator('#url-form button[value="open"]').click();
      await expect(page.locator('#hud-splats')).toHaveText('8');
      await expect(page.locator('#loading')).toBeHidden();
      if (mode === 'full') await enable(page);else { await settings(page);await page.click('#quality-memory'); }
      hold = true;await page.click('#quality-reopen');
      await expect.poll(() => held).toBe(true);
      await expect(page.locator('#hud-splats')).toHaveText('8');
      await page.click('#loading-cancel');release();
      await expect(page.locator('#loading')).toBeHidden();
      await expect(page.locator('body')).toHaveAttribute('data-loads', '0');
      await expect(page.locator('#hud-splats')).toHaveText('8');
      await expect(page.locator('#file-name')).toHaveText('delayed-sh3.ply');
      await expect(page.locator('#quality-reopen')).toBeVisible();
      if (mode === 'full') await expect(page.locator('#file-detail')).toHaveText(/Reopen required/);
    } finally { release(); }
  });
}

test('source SH4 stays honestly reduced and Full is blocked without losing the loaded scene', async ({ page }) => {
  await file(page, 4);await enable(page);
  await expect(page.locator('#quality-consequence')).toContainText('source SH 4');
  await page.click('#quality-reopen');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('body')).toContainText('source SH 4');
  await expect(page.locator('#hud-splats')).toHaveText('8');
  await expect(page.locator('#scene-info')).toContainText('2 of 4');
  await expect(page.locator('#file-detail')).not.toHaveText(/Full source/);
});

test('Spark-only files are refused under Full instead of silently adopting a fallback', async ({ page }) => {
  await file(page);await enable(page);
  await page.locator('#file-input').setInputFiles('public/samples/torus.splat');
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('body')).toContainText('supported only for standard binary Gaussian PLY');
  await expect(page.locator('#file-name')).toHaveText('source-sh3.ply');
  await expect(page.locator('#hud-splats')).toHaveText('8');
});

test('a real WebGL context reset disables Full before bounded recovery rather than retrying it', async ({ page }) => {
  await file(page);await enable(page);await page.click('#quality-reopen');
  await expect(page.locator('#file-detail')).toHaveText(/Full source/);
  await page.evaluate(async () => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Missing renderer canvas');
    const gl = canvas.getContext('webgl2');const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) throw new Error('Test requires WEBGL_lose_context');
    await new Promise<void>((resolve) => {
      canvas.addEventListener('webglcontextrestored', () => resolve(), { once: true });
      canvas.addEventListener('webglcontextlost', () => setTimeout(() => extension.restoreContext(), 250), { once: true });
      extension.loseContext();
    });
  });
  await expect(page.locator('#loading')).toBeHidden();
  await expect(page.locator('#source-detail')).not.toBeChecked();
  await expect(page.locator('#hud-splats')).toHaveText('8');
  await expect(page.locator('#scene-info')).toContainText('2 of 3');
  await expect(page.locator('#file-detail')).toHaveAttribute('title', /SH 2 of 3/);
});
