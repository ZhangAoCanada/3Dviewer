import { expect, test, type Page } from '@playwright/test';

/** The panel stays open across a reload, so a blind toggle would close it. */
async function openSettings(page: Page): Promise<void> {
  const panel = page.locator('#panel');
  if (await panel.evaluate((el) => el.classList.contains('is-collapsed'))) {
    await page.click('#panel-btn');
  }
}

test('the torus sample is full detail', async ({ page }) => {
  await page.goto('/?sample=torus-ply');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#file-detail')).toBeHidden();
  await expect(page.locator('#scene-info')).toContainText('Detail');
  await expect(page.locator('#scene-info')).toContainText('Full');
  await expect(page.locator('#scene-info')).toContainText('Active SH');
  await expect(page.locator('#scene-info')).toContainText('3 of 3');
});

test('a decode SH cap shows reduced detail until Automatic is reopened', async ({ page }) => {
  await page.goto('/?sample=torus-ply&sh=1');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  const badge = page.locator('#file-detail');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveAttribute('title', /SH 1 of 3/);
  await expect(badge).toHaveAttribute('aria-label', /SH 1 of 3/);
  await badge.click();
  await expect(page.locator('#panel')).not.toHaveClass(/is-collapsed/);
  await expect(page.locator('#sec-scene')).toHaveJSProperty('open', true);

  await page.goto('/?sample=torus-ply');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await openSettings(page);
  await page.click('#quality-memory');
  await expect(page.locator('#quality-reopen')).toBeVisible();
  await page.click('#quality-reopen');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#file-detail')).toBeVisible();
  await expect(page.locator('#file-detail')).toHaveAttribute('title', /SH 1 of 3/);

  await page.click('#quality-auto');
  await expect(page.locator('#quality-reopen')).toBeVisible();
  await page.click('#quality-reopen');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await expect(page.locator('#file-detail')).toBeHidden();
  await expect(page.locator('#scene-info')).toContainText('Full');
});

test('the render SH setting toggles reduced detail', async ({ page }) => {
  await page.goto('/?sample=torus-ply');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
  await openSettings(page);
  await page.locator('#sec-advanced summary').click();
  await page.selectOption('#sh-degree', '0');
  await expect(page.locator('#file-detail')).toBeVisible();
  await expect(page.locator('#file-detail')).toHaveAttribute('title', /Rendering SH 0/);
  await expect(page.locator('#scene-info')).toContainText('Rendering SH 0');
  await page.selectOption('#sh-degree', '3');
  await expect(page.locator('#file-detail')).toBeHidden();
});

test('meshes and Spark formats never show reduced detail', async ({ page }) => {
  for (const sample of ['torus-splat', 'crate']) {
    await page.goto(`/?sample=${sample}`);
    await expect(page.locator('#loading')).toBeHidden({ timeout: 60_000 });
    await expect(page.locator('#file-detail')).toBeHidden();
  }
});
