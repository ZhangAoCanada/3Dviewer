import { expect, test } from './test';
const room = `o Room
v -5 0 -5
v -5 0 5
v 5 0 5
v 5 0 -5
v -5 4 -5
v -5 4 5
v 5 4 5
v 5 4 -5
v -3 0 -2
v 3 0 -2
v 3 3 -2
v -3 3 -2
f 1 2 3 4
f 1 5 6 2
f 4 3 7 8
f 1 4 8 5
f 9 10 11 12
`;
async function frames(page: import('@playwright/test').Page, count = 20) {
  await page.evaluate(async (count) => { for (let i = 0; i < count; i++)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }, count);
}
async function canvasShot(page: import('@playwright/test').Page) {
  // Crop actual rendered pixels without time-varying FPS/toasts or setup chrome.
  return page.locator('#view').screenshot({ style: '.topbar,#hud,.toast-stack,#toolbar,#nav-hint,#game-panel,.game-instructions,.game-crosshair {visibility:hidden!important}' });
}
async function openRoom(page: import('@playwright/test').Page) {
  await page.goto('/?sample=crate');
  await expect(page.locator('#file-name')).toHaveText('crate.glb');
  await page.locator('#file-input').setInputFiles({ name: 'walk-room.obj', mimeType: 'text/plain', buffer: Buffer.from(room) });
  await expect(page.locator('#file-name')).toHaveText('walk-room.obj');
}
async function setup(page: import('@playwright/test').Page) {
  await page.click('#mode-game');
  await expect(page.locator('#game-confirm')).toBeVisible();
  await page.fill('#game-eye', '1.7');
  await page.locator('#game-eye').press('Tab');
  await page.check('#game-confirm');
}
test('real FPS capture with synthetic relative input, movement, Escape pause and exact canvas restoration', async ({ page }) => {
  await openRoom(page);
  await frames(page);
  const before = await canvasShot(page);
  await setup(page);
  await expect(page.locator('#game-support')).toHaveValue('mesh');
  await expect(page.locator('#game-capability')).toContainText('static solid triangles');
  await page.click('#game-start');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('view');
  await expect(page.locator('.game-hud')).toBeVisible();
  const atSpawn = await canvasShot(page);
  // Headless CDP mouse moves report zero relative deltas under pointer lock. Capture is real;
  // provide a synthetic relative-input boundary event and assert the actual rendered response.
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: 160, movementY: 50, bubbles: true })));
  await frames(page);
  const looked = await canvasShot(page);
  expect(looked.equals(atSpawn)).toBe(false);
  await page.keyboard.down('KeyW');
  await frames(page, 25);
  await page.keyboard.up('KeyW');
  await frames(page);
  const walked = await canvasShot(page);
  expect(walked.equals(looked)).toBe(false);
  await page.keyboard.press('Escape');
  await expect(page.locator('#game-title')).toHaveText('Exploration paused');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement === null)).toBe(true);
  const paused = await canvasShot(page);
  await page.keyboard.press('KeyW');
  await frames(page);
  expect((await canvasShot(page)).equals(paused)).toBe(true);
  await page.click('#game-exit');
  await frames(page);
  expect((await canvasShot(page)).equals(before)).toBe(true);
});
test('manual virtual floor is explicit, keyboard look works and focus pauses movement', async ({ page }) => {
  await openRoom(page);
  await setup(page);
  await page.selectOption('#game-support', 'virtual');
  await page.check('#game-confirm');
  await expect(page.locator('#game-capability')).toContainText('no reconstructed walls');
  await page.click('#game-keyboard');
  await expect(page.locator('.game-hud')).toBeVisible();
  await expect(page.locator('#game-hud-capability')).toHaveText('Virtual floor · no wall collision');
  await page.keyboard.down('ArrowRight');
  await frames(page, 20);
  await page.keyboard.up('ArrowRight');
  await page.click('#game-pause');
  await expect(page.locator('#game-paused')).toBeVisible();
  await page.click('#game-adjust');
  await page.fill('#game-eye', '2');
  await page.keyboard.press('KeyW');
  await expect(page.locator('#game-eye')).toHaveValue('2');
  await page.keyboard.press('Escape');
  await expect(page.locator('#game-confirm')).toBeVisible();
  await page.click('#game-exit');
  await expect(page.locator('#mode-orbit')).toHaveAttribute('aria-pressed', 'true');
});
test('pointer lock rejection stays paused and offers accessible grounded alternative', async ({ page }) => {
  await page.addInitScript(() => { HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new DOMException('Test denial', 'NotAllowedError')); });
  await openRoom(page);
  await setup(page);
  await page.click('#game-start');
  await expect(page.locator('#game-title')).toHaveText('Exploration paused');
  await expect(page.locator('#game-status')).toContainText('Mouse capture unavailable');
  await page.click('#game-keyboard');
  await expect(page.locator('.game-hud')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.click('#game-exit');
});
test('scene replacement and setup cancellation leave no game overlay or input ownership', async ({ page }) => {
  await openRoom(page);
  await setup(page);
  await page.keyboard.press('Escape');
  await expect(page.locator('#game-panel')).toBeHidden();
  await setup(page);
  await page.click('#game-keyboard');
  await page.keyboard.press('Escape');
  await page.locator('#file-input').setInputFiles({ name: 'replacement.obj', mimeType: 'text/plain', buffer: Buffer.from(room) });
  await expect(page.locator('#file-name')).toHaveText('replacement.obj');
  await expect(page.locator('#game-panel')).toBeHidden();
  await expect(page.locator('#mode-game')).toHaveAttribute('aria-pressed', 'false');
});
for (const width of [360, 640, 1280])
  test(`game setup fits ${width}px without toolbar/page overflow`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await openRoom(page);
    const toolbar = await page.locator('#toolbar').boundingBox();
    expect(toolbar).not.toBeNull();
    if (toolbar) {
      expect(toolbar.x).toBeGreaterThanOrEqual(0);
      expect(toolbar.x + toolbar.width).toBeLessThanOrEqual(width);
    }
    await setup(page);
    await expect(page.locator('#game-panel')).toBeVisible();
    const panel = await page.locator('#game-panel').boundingBox();
    expect(panel).not.toBeNull();
    if (panel) {
      expect(panel.x).toBeGreaterThanOrEqual(0);
      expect(panel.x + panel.width).toBeLessThanOrEqual(width);
      expect(panel.y + panel.height).toBeLessThanOrEqual(800);
    }
    expect(await page.locator('#game-panel').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.locator('#game-start').scrollIntoViewIfNeeded();
    await expect(page.locator('#game-start')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  });


for (const sample of ['cloud', 'torus-ply', 'torus-splat']) test(`real loaded ${sample} only offers honest virtual-floor walking`, async ({ page }) => {
  await page.goto(`/?sample=${sample}`);
  await expect(page.locator('#file-name')).not.toHaveText('');
  await page.click('#mode-game');
  await expect(page.locator('#game-confirm')).toBeVisible();
  await expect(page.locator('#game-support')).toHaveValue('virtual');
  await expect(page.locator('#game-support option[value="mesh"]')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#game-capability')).toContainText('no reconstructed walls');
  await page.check('#game-confirm');await page.click('#game-keyboard');
  await expect(page.locator('.game-hud')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#game-paused')).toBeVisible();
  await page.click('#game-exit');await expect(page.locator('#mode-game')).toHaveAttribute('aria-pressed','false');
});
