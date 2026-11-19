import { readFileSync } from 'node:fs';
import { expect, test } from './test';
const metadata: unknown = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (typeof metadata !== 'object' || metadata === null || !('version' in metadata) || typeof metadata.version !== 'string') {
  throw new Error('package.json must provide a release version');
}
const buildTag = `v${metadata.version}`;
const api = 'https://api.github.com/repos/ZhangAoCanada/3Dviewer/releases/latest';
for (const status of [200, 403, 404, 429]) {
  test(`optional lookup gracefully degrades for ${status === 200 ? 'missing tag' : status} without hiding scene errors`, async ({ page }) => {
    const pageErrors: string[] = []; const consoleErrors: { text: string; url: string }[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push({ text: message.text(), url: message.location().url }); });
    await page.route(api, (route) => route.fulfill({ status, json: status === 200 ? {} : { message: 'fixture: unavailable' } }));
    const lookup = page.waitForResponse(api);
    await page.goto('/?sample=crate'); expect((await lookup).status()).toBe(status);
    await expect(page.locator('#file-name')).toHaveText('crate.glb');
    await expect(page.locator('#download-version')).toHaveText(buildTag);
    await page.click('#mode-fly'); await expect(page.locator('#mode-fly')).toHaveAttribute('aria-pressed', 'true');
    await page.click('#reset-btn'); await expect(page.locator('#loading')).toBeHidden();
    expect(pageErrors).toEqual([]);
    // Only Chromium's exact expected HTTP failure for this fixture is allowed.
    expect(consoleErrors.filter((error) => !(status >= 400 && error.url === api && error.text.includes(String(status)) && error.text.startsWith('Failed to load resource:')))).toEqual([]);
  });
}
