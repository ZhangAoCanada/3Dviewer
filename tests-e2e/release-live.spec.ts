import { expect, test } from './test';
test.skip(process.env.OV_LIVE_RELEASE !== '1', 'Opt-in public-network observation; deterministic suite fixtures do not certify the live API');
test('[live] observe optional release lookup independently of scene operation', async ({ page }, info) => {
  const api = 'https://api.github.com/repos/ZhangAoCanada/3Dviewer/releases/latest';
  const observation: { status: number | null; error?: string } = { status: null };
  const lookup = page.waitForResponse(api).then((response) => { observation.status = response.status(); }).catch((error: unknown) => { observation.error = String(error); });
  await page.goto('/?sample=crate'); await expect(page.locator('#file-name')).toHaveText('crate.glb');
  await lookup;
  await info.attach('live-release-observation', { body: JSON.stringify(observation), contentType: 'application/json' });
  info.annotations.push({ type: 'live API', description: observation.status === 200 ? 'HTTP 200 observed; see response/version UI' : `Lookup unavailable (${observation.status ?? observation.error}); scene operation only verified` });
  await expect(page.locator('#download-version')).toHaveText(/^v\d+\.\d+\.\d+/);
});
