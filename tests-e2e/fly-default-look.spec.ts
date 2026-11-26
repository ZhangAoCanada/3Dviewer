import { expect, test } from './test';
import { instrument, renderFrame, viewPosition, distance } from './fixtures/fpsProbe';
import { releaseFlyLook } from './flyLook';

async function openCrate(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/?sample=crate');
  await expect(page.locator('#file-name')).toHaveText('crate.glb');
}

async function viewMatrix(page: import('@playwright/test').Page): Promise<number[]> {
  await renderFrame(page);
  const matrix = await page.evaluate(() => (Reflect.get(window, '__fpsDraws') as Record<string, number[]>).modelViewMatrix);
  expect(matrix).toHaveLength(16);
  return matrix!;
}

function matricesClose(a: number[], b: number[], epsilon = 1e-8): boolean {
  return a.length === b.length && a.every((value, index) => Math.abs(value - (b[index] ?? 0)) <= epsilon);
}

async function lookRight(page: import('@playwright/test').Page, movementX = 56): Promise<void> {
  await page.evaluate((movementX) => {
    const event = new MouseEvent('mousemove', { bubbles: true, cancelable: true, view: window });
    Object.defineProperty(event, 'movementX', { value: movementX });
    Object.defineProperty(event, 'movementY', { value: 0 });
    document.dispatchEvent(event);
  }, movementX);
  await renderFrame(page);
}

test('Fly button captures the mouse in the same click, without a second view click', async ({ page }, info) => {
  await instrument(page);
  await openCrate(page);
  const before = await viewMatrix(page);
  await page.click('#mode-fly');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('view');
  await expect(page.locator('#mode-fly')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#game-panel')).toBeHidden();
  expect(distance(await viewPosition(page), await viewPosition(page))).toBeLessThan(1e-5);
  const entered = await viewMatrix(page);
  // Entering Fly keeps the current camera; look is enabled, not respawned.
  expect(entered).toEqual(before);
  // First nonzero relative motion after capture is a handoff impulse, including a large toolbar delta.
  await lookRight(page, -960);
  expect(matricesClose(await viewMatrix(page), entered)).toBe(true);
  await lookRight(page);
  const looked = await viewMatrix(page);
  expect(matricesClose(looked, entered)).toBe(false);
  await page.screenshot({ path: info.outputPath('fly-locked-look.png') });
  await releaseFlyLook(page);
  await expect(page.locator('#mode-fly')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#toast-msg')).toContainText('Click the view or Fly to look around again');
  expect(matricesClose(await viewMatrix(page), looked)).toBe(true);
  await page.click('#mode-fly');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('view');
  await lookRight(page, -960);
  expect(matricesClose(await viewMatrix(page), looked)).toBe(true);
  await lookRight(page);
  const recaptured = await viewMatrix(page);
  expect(matricesClose(recaptured, looked)).toBe(false);
  await page.screenshot({ path: info.outputPath('fly-recapture-handoff.png') });
  await releaseFlyLook(page);
});

test('keyboard 2 enters Fly without auto-locking, and a view click recaptures', async ({ page }) => {
  await openCrate(page);
  await page.locator('#view').focus();
  await page.keyboard.press('Digit2');
  await expect(page.locator('#mode-fly')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  await expect(page.locator('#toast-msg')).toContainText('Click the view or Fly to look around with the mouse');
  const box = await page.locator('#view').boundingBox();
  if (!box) throw new Error('No canvas');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('view');
  await releaseFlyLook(page);
});

test('first locked move after Fly click or keyboard-2 recapture is ignored; later small moves apply', async ({ page }, info) => {
  await instrument(page);
  await openCrate(page);
  await page.locator('#view').focus();
  await page.keyboard.press('Digit2');
  await expect(page.locator('#mode-fly')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  const box = await page.locator('#view').boundingBox();
  if (!box) throw new Error('No canvas');
  const unlocked = await viewMatrix(page);
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('view');
  const captured = await viewMatrix(page);
  expect(captured).toEqual(unlocked);
  await lookRight(page, -960);
  expect(await viewMatrix(page)).toEqual(captured);
  await lookRight(page, 20);
  const once = await viewMatrix(page);
  expect(once).not.toEqual(captured);
  await lookRight(page, 20);
  const twice = await viewMatrix(page);
  expect(twice).not.toEqual(once);
  await page.screenshot({ path: info.outputPath('fly-keyboard2-handoff.png') });
  await releaseFlyLook(page);
});

test('Orbit stays unlocked and Game still captures in one click', async ({ page }) => {
  await openCrate(page);
  await page.click('#mode-fly');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('view');
  await releaseFlyLook(page);
  await page.click('#mode-orbit');
  await expect(page.locator('#mode-orbit')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  await page.click('#mode-game');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('view');
  await expect(page.locator('#game-panel')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.locator('#game-paused')).toBeVisible();
});

test('denied Fly capture still allows drag-look and stays in Fly', async ({ page }, info) => {
  await instrument(page, false, true);
  await openCrate(page);
  await page.click('#mode-fly');
  await expect(page.locator('#mode-fly')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => document.pointerLockElement)).toBeNull();
  await expect(page.locator('#toast-msg')).toContainText('Mouse capture unavailable');
  const before = await viewMatrix(page);
  const box = await page.locator('#view').boundingBox();
  if (!box) throw new Error('No canvas');
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5 + 70, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await renderFrame(page);
  expect(await viewMatrix(page)).not.toEqual(before);
  await page.screenshot({ path: info.outputPath('fly-denied-drag-look.png') });
  await expect(page.locator('#mode-fly')).toHaveAttribute('aria-pressed', 'true');
});
