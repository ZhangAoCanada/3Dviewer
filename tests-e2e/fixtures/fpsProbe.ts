import { expect, type Page } from '@playwright/test';

export async function instrument(page: Page, retainedFocus = false, denyLock = false) {
  await page.addInitScript(({ retainedFocus, denyLock }) => {
    const names = new WeakMap<WebGLUniformLocation, {name:string;kind:string}>();
    const draws: Record<string, number[]> = {};
    const kinds = new WeakMap<WebGLProgram,string>();
    Object.assign(window, { __fpsDraws: draws });
    // Observe actual matrices uploaded to WebGL. No application debug/state hook.
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const get = proto.getUniformLocation, put = proto.uniformMatrix4fv;
      proto.getUniformLocation = function(program, name) { const result = get.call(this,program,name); if(result) { let kind=kinds.get(program);if(!kind){ const source=(this.getAttachedShaders(program)??[]).map(shader=>this.getShaderSource(shader)??'').join('\n');kind=/#define SHADER_TYPE (\w+)/.exec(source)?.[1]??'unknown';kinds.set(program,kind); } names.set(result,{name,kind}); } return result; };
      proto.uniformMatrix4fv = function(location: WebGLUniformLocation | null, transpose: boolean, data: Float32List, ...args: number[]) {
        const uniform = location ? names.get(location) : null;
        if(uniform?.name === 'modelViewMatrix') { const m=Array.from(data).slice(0,16);draws.modelViewMatrix=m;draws[uniform.kind+':modelViewMatrix']=m; }
        return Reflect.apply(put,this,[location,transpose,data,...args]);
      };
    }
    if(retainedFocus) {
      HTMLCanvasElement.prototype.focus = () => {};
      // Fault-injection fixture: keep entry controls rendered so Chromium really retains
      // button focus instead of moving it to body when production chrome is hidden.
      document.addEventListener('DOMContentLoaded',()=>{
        const style=document.createElement('style');
        style.textContent='.is-game-playing #toolbar{visibility:visible!important}#game-panel[hidden],#game-start-actions[hidden]{display:block!important;visibility:hidden}#game-panel[hidden] #game-start,#game-panel[hidden] #game-keyboard{visibility:visible}';
        document.head.append(style);
      });
    }
    if(denyLock) HTMLCanvasElement.prototype.requestPointerLock = () => Promise.reject(new DOMException('Test denial','NotAllowedError'));
  }, { retainedFocus, denyLock });
}
export async function renderFrame(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
export async function viewPosition(page: Page, reference = 'modelViewMatrix') {
  await renderFrame(page);
  const matrix = await page.evaluate(reference => (Reflect.get(window,'__fpsDraws') as Record<string, number[]>)[reference],reference);
  expect(matrix).toHaveLength(16);
  // The last render is our fixed-world reference grid (or one fixed sample object).
  const m=matrix!;
  for(const i of [0,4,8]) expect(Math.hypot(m[i]!,m[i+1]!,m[i+2]!)).toBeCloseTo(1,4);
  return [-(m[0]!*m[12]!+m[1]!*m[13]!+m[2]!*m[14]!), -(m[4]!*m[12]!+m[5]!*m[13]!+m[6]!*m[14]!), -(m[8]!*m[12]!+m[9]!*m[13]!+m[10]!*m[14]!)] as const;
}
export async function pixels(page: Page) {
  return page.locator('#view').screenshot({style:'.topbar,#hud,.toast-stack,#toolbar,#nav-hint,#game-panel,#panel,.game-hud {opacity:0!important}'});
}
export function distance(a: readonly number[], b: readonly number[]) { return Math.hypot(a[0]!-b[0]!,a[1]!-b[1]!,a[2]!-b[2]!); }
export async function hold(page: Page, code: string, reference = 'modelViewMatrix') {
  const before = await viewPosition(page,reference), image = await pixels(page);
  await page.keyboard.down(code);
  // Continuous trusted browser key hold, not a tiny tap or injected DOM key event.
  await page.waitForTimeout(1250);
  await page.keyboard.up(code);
  const after = await viewPosition(page,reference), moved = distance(before,after);
  const changed = !image.equals(await pixels(page));
  await expect(page.locator('.game-hud')).toBeVisible();
  expect(changed, `Rendered scene must change during ${code}: displacement=${moved}, before=${before}, after=${after}`).toBe(true);
  const resting = await viewPosition(page,reference); await page.waitForTimeout(180);
  expect(distance(await viewPosition(page,reference),resting)).toBeLessThan(1e-4);
  return moved;
}
