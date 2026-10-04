import { chromium, expect, test } from '@playwright/test';

const origin = 'http://127.0.0.1:4173/3Dviewer/';

test('a normal load does not request the benchmark chunk', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await page.goto('/?sample=torus-ply');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await page.waitForTimeout(300);
  expect(urls.some((url) => /runBench|benchStats|\/bench/i.test(url))).toBe(false);
});

test('?bench=1 reports the crate sample and restores the camera', async () => {
  test.setTimeout(120_000);
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const context = await browser.newContext({
    baseURL: origin,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    // torus-ply Spark sorts on CI SwiftShader exceed the 40 s budget (stuck on
    // "Reloading 3 of 3…"). The crate mesh still runs the full report path.
    await page.goto('/?sample=crate&bench=1');
    await expect(page.locator('#bench-dialog')).toBeVisible();
    await expect(page.locator('#bench-status')).toHaveText('Done.', { timeout: 40_000 });
    await page.click('#bench-copy-json');
    const text = await page.evaluate(() => navigator.clipboard.readText());
    const report = JSON.parse(text) as {
      schema: string;
      frames: { p50: unknown; p90: unknown; p99: unknown };
      reloads: { ok: boolean }[];
      camera: { before: { position: number[]; pivot: number[] }; after: { position: number[]; pivot: number[] } };
    };
    expect(report.schema).toBe('omniview-bench/1');
    expect(report.frames.p50).toEqual(expect.any(Number));
    expect(report.frames.p90).toEqual(expect.any(Number));
    expect(report.frames.p99).toEqual(expect.any(Number));
    expect(report.reloads.filter((row) => row.ok)).toHaveLength(3);
    expect(maxDrift(report.camera.before.position, report.camera.after.position)).toBeLessThan(1e-6);
    expect(maxDrift(report.camera.before.pivot, report.camera.after.pivot)).toBeLessThan(1e-6);
    expect(errors).toEqual([]);
    await page.goto('about:blank');
  } finally {
    await browser.close();
  }
});

function maxDrift(before: number[], after: number[]): number {
  return before.reduce((max, value, index) => Math.max(max, Math.abs(value - (after[index] ?? value))), 0);
}
