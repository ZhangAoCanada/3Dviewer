import { expect, test } from './test';
import type { Page } from '@playwright/test';

async function instrument(page: Page, retainedFocus = false, denyLock = false) {
  await page.addInitScript(({ retainedFocus, denyLock }) => {
    const names = new WeakMap<WebGLUniformLocation, string>();
    const draws: Record<string, number[]> = {};
    Object.assign(window, { __fpsDraws: draws });
    // Observe actual matrices uploaded to WebGL. No application debug/state hook.
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const get = proto.getUniformLocation, put = proto.uniformMatrix4fv;
      proto.getUniformLocation = function(program, name) { const result = get.call(this,program,name); if(result) names.set(result,name); return result; };
      proto.uniformMatrix4fv = function(location: WebGLUniformLocation | null, transpose: boolean, data: Float32List, ...args: number[]) {
        const name = location ? names.get(location) : null;
        if(name === 'modelViewMatrix') draws[name] = Array.from(data).slice(0,16);
        return Reflect.apply(put,this,[location,transpose,data,...args]);
      };
    }
    if(retainedFocus) HTMLCanvasElement.prototype.focus = () => {};
    if(denyLock) HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new DOMException('Test denial','NotAllowedError'));
  }, { retainedFocus, denyLock });
}
async function renderFrame(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
async function viewPosition(page: Page) {
  await renderFrame(page);
  const matrix = await page.evaluate(() => (Reflect.get(window,'__fpsDraws') as Record<string, number[]>).modelViewMatrix);
  expect(matrix).toHaveLength(16);
  // The last render is our fixed-world reference grid (or one fixed sample object).
  const m=matrix!;
  for(const i of [0,4,8]) expect(Math.hypot(m[i]!,m[i+1]!,m[i+2]!)).toBeCloseTo(1,4);
  return [-(m[0]!*m[12]!+m[1]!*m[13]!+m[2]!*m[14]!), -(m[4]!*m[12]!+m[5]!*m[13]!+m[6]!*m[14]!), -(m[8]!*m[12]!+m[9]!*m[13]!+m[10]!*m[14]!)] as const;
}
async function pixels(page: Page) {
  return page.locator('#view').screenshot({style:'.topbar,#hud,.toast-stack,#toolbar,#nav-hint,#game-panel,#panel,.game-hud {visibility:hidden!important}'});
}
function distance(a: readonly number[], b: readonly number[]) { return Math.hypot(a[0]!-b[0]!,a[1]!-b[1]!,a[2]!-b[2]!); }
async function hold(page: Page, code: string) {
  const before = await viewPosition(page), image = await pixels(page);
  await page.keyboard.down(code);
  // Continuous trusted browser key hold, not a tiny tap or injected DOM key event.
  await page.waitForTimeout(1250);
  await page.keyboard.up(code);
  const after = await viewPosition(page), moved = distance(before,after);
  const changed = !image.equals(await pixels(page));
  await expect(page.locator('.game-hud')).toBeVisible();
  expect(changed).toBe(true);
  const resting = await viewPosition(page); await page.waitForTimeout(180);
  expect(distance(await viewPosition(page),resting)).toBeLessThan(1e-4);
  return moved;
}
for(const sample of ['crate','cloud']) test(`Game directly enters rendered FPS and continuous WASD visibly translates ${sample}`,async({page},info)=>{
  await instrument(page);
  await page.goto(`/?sample=${sample}`); await expect(page.locator('#loading')).toBeHidden();
  await page.click('#mode-game');
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');
  await expect(page.locator('#game-panel')).toBeHidden();
  await expect(page.locator('#game-hud-capability')).toContainText('Virtual floor');
  const eye = Number(await page.locator('#game-eye').inputValue());
  await page.screenshot({path:info.outputPath(`${sample}-direct-entry.png`)});
  const distances: Record<string,number> = {};
  for(const code of ['KeyW','KeyA','KeyS','KeyD']) {
    await page.keyboard.press('KeyR'); distances[code] = await hold(page,code);
    expect(distances[code]).toBeGreaterThan(eye*.7);
    await page.screenshot({path:info.outputPath(`${sample}-${code}-held.png`)});
  }
  await info.attach('rendered-camera-displacement',{body:JSON.stringify({sample,eye,distances}),contentType:'application/json'});
});
test('native pointer capture owns WASD despite retained Game and Resume button focus',async({page})=>{
  await instrument(page,true);
  await page.goto('/?sample=cloud'); await expect(page.locator('#loading')).toBeHidden(); await page.click('#mode-game');
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');
  await expect(page.locator('#mode-game')).toBeFocused();
  const eye=Number(await page.locator('#game-eye').inputValue()); expect(await hold(page,'KeyW')).toBeGreaterThan(eye*.7);
  await page.keyboard.press('Escape'); await page.click('#game-start');
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');
  await expect(page.locator('#game-start')).toBeFocused(); expect(await hold(page,'KeyA')).toBeGreaterThan(eye*.7);
});
test('direct capture denial offers keyboard look; retained fallback button still walks visibly',async({page})=>{
  await instrument(page,true,true);
  await page.goto('/?sample=cloud');await expect(page.locator('#loading')).toBeHidden();await page.click('#mode-game');
  await expect(page.locator('#game-status')).toContainText('Mouse capture unavailable');
  await page.click('#game-keyboard');await expect(page.locator('#game-keyboard')).toBeFocused();
  const eye=Number(await page.locator('#game-eye').inputValue());expect(await hold(page,'KeyD')).toBeGreaterThan(eye*.7);
});
