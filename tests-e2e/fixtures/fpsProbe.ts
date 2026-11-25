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

export interface RenderedPoseObservation {samples:number;minY:number;maxY:number;lastY:number;png:string|null;pngY:number|null}
/** Observe actual uploads with O(1) pose history; optionally capture one coherent complete canvas frame. */
export async function observeRenderedPose(page:Page,reference:string,captureAboveY?:number){
 await page.evaluate(({reference,captureAboveY})=>{
  const draws=Reflect.get(window,'__fpsDraws')as Record<string,number[]>;let latest=draws[reference]!;
  const y=(m:number[])=>-(m[4]!*m[12]!+m[5]!*m[13]!+m[6]!*m[14]!);
  const probe:RenderedPoseObservation={samples:0,minY:y(latest),maxY:y(latest),lastY:y(latest),png:null,pngY:null};let queued=false;
  Reflect.set(window,'__renderedPoseObservation',probe);
  Object.defineProperty(draws,reference,{configurable:true,get:()=>latest,set:(m:number[])=>{
   latest=m;const height=y(m);probe.samples++;probe.minY=Math.min(probe.minY,height);probe.maxY=Math.max(probe.maxY,height);probe.lastY=height;
   if(captureAboveY===undefined||height<=captureAboveY||probe.png||queued)return;queued=true;
   // The microtask runs after synchronous renderer.render, before canvas compositing clears its buffer.
   queueMicrotask(()=>{const canvas=document.querySelector('#view');if(!(canvas instanceof HTMLCanvasElement)||canvas.width*canvas.height>4_194_304)throw Error('Invalid bounded render fixture');probe.png=canvas.toDataURL('image/png');probe.pngY=height;});
  }});
 },{reference,captureAboveY});
}
export async function renderedPoseObservation(page:Page):Promise<RenderedPoseObservation>{return page.evaluate(()=>Reflect.get(window,'__renderedPoseObservation'));}

/** Compare actual renderer pixels, excluding only the4px CSS focus outline outside the drawing buffer. */
export async function canvasInteriorPixels(png:Buffer){const{default:sharp}=await import('sharp');const image=sharp(png),meta=await image.metadata();if(!meta.width||!meta.height||meta.width<=8||meta.height<=8)throw Error('Invalid canvas frame dimensions');return image.extract({left:4,top:4,width:meta.width-8,height:meta.height-8}).removeAlpha().raw().toBuffer();}
