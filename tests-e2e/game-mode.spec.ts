import { expect, test } from './test';
import { gameRoom as room } from './fixtures/gameRoom';
import { releaseFlyLook } from './flyLook';
async function frames(page: import('@playwright/test').Page, count = 20) {
  await page.evaluate(async (count) => { for (let i = 0; i < count; i++)
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve())); }, count);
}
async function canvasShot(page: import('@playwright/test').Page) {
  // Crop actual rendered pixels without time-varying FPS/toasts or setup chrome.
  return page.locator('#view').screenshot({ style: '.topbar,#hud,.toast-stack,#toolbar,#nav-hint,#game-panel,#panel,.game-instructions,.game-crosshair {visibility:hidden!important}' });
}
async function openRoom(page: import('@playwright/test').Page) {
  await page.goto('/?sample=crate');
  await expect(page.locator('#file-name')).toHaveText('crate.glb');
  await page.locator('#file-input').setInputFiles({ name: 'walk-room.obj', mimeType: 'text/plain', buffer: Buffer.from(room) });
  await expect(page.locator('#file-name')).toHaveText('walk-room.obj');
}
async function setup(page: import('@playwright/test').Page) {
  await page.click('#mode-game');
  await expect(page.locator('#game-panel')).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.pointerLockElement?.id)).toBe('view');
  await page.keyboard.press('Escape');
  await page.click('#game-adjust');
  await expect(page.locator('#game-confirm')).toBeVisible();
  await expect(page.locator('#game-support option[value="mesh"]')).toHaveJSProperty('disabled',false);
  await page.selectOption('#game-support','mesh');
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
  // Capture handoff must reject a sidebar-to-center sized impulse before ordinary look.
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mousemove', { movementX: -960, movementY: 0, bubbles: true })));
  await frames(page);expect((await canvasShot(page)).equals(atSpawn)).toBe(true);
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
  await page.click('#game-start');await expect(page.locator('#game-status')).toContainText('Check');
  await page.fill('#game-eye', '0');await page.locator('#game-eye').press('Tab');
  await page.click('#game-start');await expect(page.locator('#game-status')).toContainText('Eye height');
  await page.click('#game-exit');
  await expect(page.locator('#mode-orbit')).toHaveAttribute('aria-pressed', 'true');
});
test('pointer lock rejection stays paused and offers accessible grounded alternative', async ({ page }) => {
  await page.addInitScript(() => { HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new DOMException('Test denial', 'NotAllowedError')); });
  await openRoom(page);
  await page.click('#mode-game');
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
  // Escape is a session command only outside the editable/checkbox controls.
  await page.locator('#game-title').focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#game-paused')).toBeVisible();
  await page.click('#game-exit');
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
  await expect(page.locator('#game-panel')).toBeHidden();
  await page.keyboard.press('Escape');await page.click('#game-adjust');
  await expect(page.locator('#game-confirm')).toBeVisible();
  await expect(page.locator('#game-support')).toHaveValue('virtual');
  await expect(page.locator('#game-support option[value="mesh"]')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#game-capability')).toContainText('no reconstructed walls');
  if (sample === 'cloud') await page.uncheck('#game-guide');
  await page.check('#game-confirm');await page.click('#game-keyboard');
  await expect(page.locator('.game-hud')).toBeVisible();
  if (sample === 'cloud') {
    // Thin content used to appear only at the bottom edge: entry must frame actual colored geometry.
    await frames(page);
    const {default:sharp} = await import('sharp');
    const image = sharp(await canvasShot(page)), metadata = await image.metadata();
    const width = metadata.width!, height = metadata.height!;
    const pixels = await image.extract({left:Math.floor(width*.25),top:Math.floor(height*.25),width:Math.floor(width*.5),height:Math.floor(height*.5)}).removeAlpha().raw().toBuffer();
    let colored=0;for(let i=0;i<pixels.length;i+=3)if(Math.max(pixels[i]!,pixels[i+1]!,pixels[i+2]!)-Math.min(pixels[i]!,pixels[i+1]!,pixels[i+2]!)>40)colored++;
    expect(colored).toBeGreaterThan(50);
  }
  await page.keyboard.press('Escape');await expect(page.locator('#game-paused')).toBeVisible();
  await page.click('#game-exit');await expect(page.locator('#mode-game')).toHaveAttribute('aria-pressed','false');
});

test('setup navigation shortcuts do not abandon game setup, and R resets inspection without discarding it',async({page})=>{
 await openRoom(page);await setup(page);
 // This case owns inspector reset; non-inspecting Reset now intentionally restores draft values.
 await page.click('#game-inspect');await expect(page.locator('#game-inspect')).toHaveText('Keep FPS view');await page.locator('#game-title').focus();
 for(const key of ['Digit1','Digit2','KeyR']){await page.keyboard.press(key);await expect(page.locator('#game-confirm')).toBeVisible();await expect(page.locator('#mode-game')).toHaveAttribute('aria-pressed','true');}
 await expect(page.locator('#game-eye')).toHaveValue('1.7');await page.click('#game-exit');
});

test('quality reopen from paused game preserves an independently aimed Fly view',async({page})=>{
 await page.goto('/?sample=torus-ply');await expect(page.locator('#loading')).toBeHidden();
 await page.click('#mode-fly');
 await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');
 await page.evaluate(()=>{for (const movementX of [1, 45]) {const event=new MouseEvent('mousemove',{bubbles:true,cancelable:true,view:window});Object.defineProperty(event,'movementX',{value:movementX});Object.defineProperty(event,'movementY',{value:0});document.dispatchEvent(event);}});
 await frames(page,30);
 await releaseFlyLook(page);
 const toastClose=page.locator('#toast-close');
 if(await toastClose.isVisible()) await toastClose.click();
 const centroid=async()=>{const {default:sharp}=await import('sharp');const {data,info}=await sharp(await canvasShot(page)).removeAlpha().raw().toBuffer({resolveWithObject:true});let x=0,y=0,n=0;for(let i=0;i<data.length;i+=info.channels){const r=data[i]!,g=data[i+1]!,b=data[i+2]!;if(Math.max(r,g,b)-Math.min(r,g,b)>40){const pixel=i/info.channels;x+=pixel%info.width;y+=Math.floor(pixel/info.width);n++;}}expect(n).toBeGreaterThan(500);return {x:x/n,y:y/n};};
 const before=await centroid();
 await page.click('#mode-game');await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');await page.keyboard.press('Escape');
 await page.click('#panel-btn');await page.click('#quality-memory');await expect(page.locator('#quality-reopen')).toBeVisible();await page.click('#quality-reopen');
 await expect(page.locator('#loading')).toBeHidden({timeout:60000});await expect(page.locator('#mode-fly')).toHaveAttribute('aria-pressed','true');await expect(page.locator('#game-panel')).toBeHidden();await frames(page,40);
 const after=await centroid();expect(Math.hypot(after.x-before.x,after.y-before.y)).toBeLessThan(8);
});
