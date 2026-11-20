import { expect, test, type Page } from './test';
import { gaussianPlyFixture } from '../tests/fixtures/gaussianPlyFixture';

const profiles = [
  { width: 320, height: 420, hasTouch: true },
  { width: 641, height: 600, hasTouch: false },
  { width: 641, height: 600, hasTouch: true },
  { width: 1280, height: 800, hasTouch: false },
  { width: 1920, height: 1080, hasTouch: false },
  { width: 360, height: 420, hasTouch: true },
  { width: 390, height: 844, hasTouch: true },
  { width: 640, height: 400, hasTouch: false },
  { width: 360, height: 420, hasTouch: false },
];
async function geometry(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.topbar button')].filter(el => el.getClientRects().length).map(el => {
      const r = el.getBoundingClientRect();
      return { id: el.id, ...box(`#${el.id}`), hit: el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) };
    });
    return { brand: box('.brand'), actions: box('.top-actions'), toolbar: box('#toolbar'), filename: box('#file-name'), panel: box('#panel'), buttons, overflow: document.documentElement.scrollWidth > innerWidth, scrollX };
  });
}
for (const theme of ['light', 'dark'] as const) for (const profile of profiles) {
  test.describe(`${theme} ${profile.width}x${profile.height} ${profile.hasTouch ? 'coarse' : 'fine'} chrome`, () => {
    test.use({ viewport: { width: profile.width, height: profile.height }, hasTouch: profile.hasTouch });
    test('balanced content-sized islands, actual long filename import, details and reachable actions', async ({ page }, info) => {
      await page.addInitScript(t => localStorage.setItem('3dviewer-theme', t), theme);
      await page.goto('/?sh=2');await expect(page.locator('#empty')).toBeVisible();
      await expect(page.locator('.brand-name')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const inset = profile.width <= 640 ? 8 : 12;
      const minimum = profile.hasTouch ? 44 : 34;
      for (const state of ['empty', 'loaded'] as const) {
        const g = await geometry(page);
        expect(g.overflow).toBe(false);expect(g.scrollX).toBe(0);
        expect(g.brand.x).toBeCloseTo(inset, 0);expect(g.actions.right).toBeCloseTo(profile.width - inset, 0);
        expect(g.brand.y).toBe(g.actions.y);expect(g.brand.height).toBe(g.actions.height);
        expect(g.brand.height).toBeLessThanOrEqual(56);expect(g.brand.right + 8).toBeLessThanOrEqual(g.actions.x + 1);
        expect(g.toolbar.x).toBeGreaterThanOrEqual(0);expect(g.toolbar.right).toBeLessThanOrEqual(profile.width);
        for (const b of g.buttons) {
          expect(b.width, b.id).toBeGreaterThanOrEqual(minimum);expect(b.height, b.id).toBeGreaterThanOrEqual(minimum);expect(b.hit, b.id).toBe(true);
          expect(b.y, b.id).toBeGreaterThanOrEqual(g.brand.y + 4);expect(b.bottom, b.id).toBeLessThanOrEqual(g.brand.bottom - 4);
        }
        if (profile.width === 1280) expect(g.actions.width).toBeLessThanOrEqual(460);
        if (state === 'empty') {
          expect(g.brand.width).toBeLessThan(g.actions.width); // content-sized, not artificial equal-width panels
          await expect(page.locator('.brand-name')).toHaveCSS('font-size', '14px');
          const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#open-btn').click()]);
          const name = `field-survey__station-047__${'source-detail-and-original-capture_'.repeat(5)}.ply`;
          await chooser.setFiles({ name, mimeType: 'application/octet-stream', buffer: gaussianPlyFixture() });
          await expect(page.locator('#hud-splats')).toHaveText('8');await expect(page.locator('#loading')).toBeHidden();
          await expect(page.locator('#file-name')).toHaveAttribute('title', name);
        } else {
          expect(g.filename.width).toBeGreaterThanOrEqual(35);
          await expect(page.locator('#file-detail')).toHaveAttribute('title', /requested load cap/);
        }
        await info.attach(`${state}-geometry`, { body: JSON.stringify(g), contentType: 'application/json' });
      }
      await page.locator('#file-detail').focus();await page.keyboard.press('Enter');
      await expect(page.locator('#panel')).not.toHaveClass(/is-collapsed/);
      await expect(page.locator('#quality-loaded-reason')).toContainText('requested load cap');
      const opened = await geometry(page);
      expect(opened.panel.width).toBe(profile.width <= 640 ? profile.width - 16 : 400);
      if (profile.width > 640) expect(opened.panel.y).toBeGreaterThanOrEqual(opened.actions.bottom + 7);
      expect(await page.locator('.panel-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      await page.keyboard.press('Escape');await expect(page.locator('#panel-btn')).toBeFocused();
      if (profile.width <= 640) {
        await page.click('#more-btn');await expect(page.getByRole('menuitem', { name: 'Open from URL', exact: true })).toBeInViewport();
        await page.keyboard.press('Escape');await expect(page.locator('#more-btn')).toBeFocused();
      }
      const after = await geometry(page);expect(after.overflow).toBe(false);expect(after.scrollX).toBe(0);
      await expect(page.locator('#hud-splats')).toHaveText('8');
    });
  });
}


test('desktop Samples stays pointer reachable above an open Settings drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });await page.goto('/');
  await page.click('#panel-btn');await expect(page.locator('#panel')).not.toHaveClass(/is-collapsed/);
  await page.click('#samples-btn');
  const crate = page.locator('#samples-menu').getByRole('menuitem', { name: 'Mesh crate (.glb)' });
  await expect(crate).toBeInViewport();await crate.click(); // native hit testing, no force or DOM click
  await expect(page.locator('#file-name')).toHaveText('crate.glb');await expect(page.locator('#hud-tris')).toHaveText('12');
  await expect(page.locator('#panel')).not.toHaveClass(/is-collapsed/);
});
