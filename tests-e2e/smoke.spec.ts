import { expect, test } from '@playwright/test';

const loads = [
  { query: '?sample=torus-ply', hud: '#hud-splats' },
  { query: '?sample=torus-splat', hud: '#hud-splats' },
  { query: '?sample=cloud', hud: '#hud-points' },
  { query: '?sample=crate', hud: '#hud-tris' },
  { query: '?sample=sphere', hud: '#hud-tris' },
  { query: '?demo=slab', hud: '#hud-splats' },
];

for (const item of loads) {
  test(`loads ${item.query}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      const url = message.location().url;
      errors.push(url ? `${message.text()} (${url})` : message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (response) => {
      if (response.status() < 400) return;
      errors.push(`${response.status()} ${response.url()}`);
    });

    await page.goto(`/${item.query}`);
    await page.waitForFunction(
      (selector) => {
        const loading = document.querySelector('#loading');
        const hud = document.querySelector(selector);
        if (!loading?.hasAttribute('hidden') || !hud) return false;
        const text = hud.textContent ?? '';
        if (text.trim() === '' || text === '—') return false;
        const count = Number(text.replace(/,/g, ''));
        return Number.isFinite(count) && count > 0;
      },
      item.hud,
    );

    await expect(page.locator('#loading')).toHaveAttribute('hidden', '');
    const text = await page.locator(item.hud).innerText();
    const count = Number(text.replace(/,/g, ''));
    expect(count).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
}
