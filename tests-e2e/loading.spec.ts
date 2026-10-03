import { chromium, expect, test, type Page } from '@playwright/test';

const origin = 'http://127.0.0.1:4173/3Dviewer/';

function hangUrl(): string {
  return new URL('hang.ply', origin).href;
}

async function failOnPageError(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** SH0 binary little-endian gaussian PLY. 200,000 splats × 56 bytes is about 11 MB. */
function sh0Ply(count: number): Buffer {
  const props = [
    'x',
    'y',
    'z',
    'f_dc_0',
    'f_dc_1',
    'f_dc_2',
    'opacity',
    'scale_0',
    'scale_1',
    'scale_2',
    'rot_0',
    'rot_1',
    'rot_2',
    'rot_3',
  ];
  const header = Buffer.from(
    ['ply', 'format binary_little_endian 1.0', `element vertex ${count}`, ...props.map((name) => `property float ${name}`), 'end_header', ''].join(
      '\n',
    ),
  );
  const stride = props.length * 4;
  const body = Buffer.alloc(count * stride);
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  for (let i = 0; i < count; i += 1) {
    const offset = i * stride;
    view.setFloat32(offset, (i % 512) * 0.02, true);
    view.setFloat32(offset + 4, Math.floor(i / 512) * 0.02, true);
    view.setFloat32(offset + 8, (i % 7) * 0.01, true);
    view.setFloat32(offset + 24, 2, true);
    view.setFloat32(offset + 28, -4, true);
    view.setFloat32(offset + 32, -4, true);
    view.setFloat32(offset + 36, -4, true);
    view.setFloat32(offset + 40, 1, true);
  }
  return Buffer.concat([header, body]);
}

test('shows a stall hint when a remote read makes no progress', async ({ page }) => {
  await page.clock.install();
  await page.route('**/hang.ply', () => {});
  await page.goto(`/?url=${encodeURIComponent(hangUrl())}`);
  await expect(page.locator('[data-step="reading"]')).toHaveClass(/is-active/);
  await page.clock.fastForward(12_000);
  await expect(page.locator('#loading-detail')).toContainText('No data from');
});

test('cancel during reading aborts the remote request', async ({ page }) => {
  const failed: string[] = [];
  page.on('requestfailed', (request) => failed.push(request.url()));
  await page.route('**/hang.ply', () => {});
  await page.goto(`/?url=${encodeURIComponent(hangUrl())}`);
  await expect(page.locator('[data-step="reading"]')).toHaveClass(/is-active/);
  await page.click('#loading-cancel');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 500 });
  await expect.poll(() => failed.some((url) => url.includes('hang.ply'))).toBe(true);
});

test('cancel during preparing hides the card and leaves the chip empty', async ({ page }) => {
  const errors = await failOnPageError(page);
  let cancelledAt = 0;
  await page.exposeFunction('__cancelled', () => {
    cancelledAt = Date.now();
  });
  // Decode of this file finishes in one frame on a fast host, so click in the same turn Preparing appears.
  await page.addInitScript(() => {
    const watch = () => {
      const step = document.querySelector('[data-step="preparing"].is-active');
      const loading = document.querySelector<HTMLElement>('#loading');
      const button = document.querySelector<HTMLButtonElement>('#loading-cancel');
      if (step && loading && !loading.hidden && button && !button.hidden) {
        void (window as unknown as { __cancelled?: () => void }).__cancelled?.();
        button.click();
        return;
      }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
  const body = sh0Ply(200_000);
  await page.route('**/prep.ply', (route) => {
    const headers = { 'content-type': 'application/octet-stream', 'content-length': String(body.length) };
    if (route.request().method() === 'HEAD') {
      return route.fulfill({ status: 200, headers, body: '' });
    }
    return route.fulfill({ status: 200, headers, body });
  });
  const url = new URL('prep.ply', origin).href;
  await page.goto(`/?url=${encodeURIComponent(url)}`, { waitUntil: 'commit' });
  await expect(page.locator('#loading')).toBeHidden({ timeout: 30_000 });
  expect(cancelledAt).toBeGreaterThan(0);
  expect(Date.now() - cancelledAt).toBeLessThan(500);
  await expect(page.locator('#file-chip')).toBeHidden();
  expect(errors).toEqual([]);
  await page.goto('about:blank');
});

test('slab badge reaches ready and then hides', async () => {
  // Own browser: a 300k sort in the shared browser wedges SwiftShader for the next test.
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ baseURL: origin });
  try {
    await page.goto('/?demo=slab&n=300000');
    const badge = page.locator('#file-quality');
    await expect(badge).toHaveText('Ready', { timeout: 45_000 });
    await expect(badge).toBeHidden({ timeout: 10_000 });
    await page.goto('about:blank');
  } finally {
    await browser.close();
  }
});
