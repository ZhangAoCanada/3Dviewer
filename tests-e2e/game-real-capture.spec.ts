import {test,expect} from './test';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {instrument,hold,viewPosition} from './fixtures/fpsProbe';
const fixture=process.env.OV_REAL_GS_FIXTURE;
test('bounded real captured Gaussians visibly move, jump and crouch with honest virtual support',async({page},testInfo)=>{
 test.skip(!fixture,'Set OV_REAL_GS_FIXTURE to the documented 8192 original-Gaussian public subset; no full-density claim.');
 if(!fixture)return;
 const body=await readFile(fixture);expect(createHash('sha256').update(body).digest('hex')).toBe('032129e9d9e2df17a5ca1d70aba67b46616fe8ef9e05c0b0d93d54c59aa9eea7');
 await page.setViewportSize({width:640,height:480});await instrument(page);
 await page.route('https://sparkjs.dev/assets/splats/butterfly.spz',route=>route.fulfill({body,contentType:'application/octet-stream',headers:{'access-control-allow-origin':'*'}}));
 await page.goto('/?sample=butterfly');await expect(page.locator('#loading')).toBeHidden();await page.click('#mode-game');await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');
 await expect(page.locator('#game-hud-capability')).toHaveText('Virtual floor · no wall collision');
 const mask=async()=>{const{data,info}=await sharp(await page.screenshot()).extract({left:128,top:120,width:384,height:192}).removeAlpha().raw().toBuffer({resolveWithObject:true});return Array.from({length:info.width*info.height},(_,i)=>{const c=[data[i*3]!,data[i*3+1]!,data[i*3+2]!];return Math.max(...c)>55&&Math.max(...c)-Math.min(...c)>30?1:0;});};
 await expect.poll(async()=>(await mask()).reduce<number>((a,b)=>a+b,0)).toBeGreaterThan(100);
 await page.screenshot({path:testInfo.outputPath('real-gs-entry.png')});const image=await mask(),eye=Number(await page.locator('#game-eye').inputValue()),moves:Record<string,number>={};
 let changed=0;for(const key of ['KeyW','KeyS','KeyA','KeyD']){moves[key]=await hold(page,key);expect(moves[key]).toBeGreaterThan(eye*.7);if(key==='KeyW')changed=(await mask()).reduce<number>((count,value,i)=>count+(value!==image[i]?1:0),0);}
 expect(changed).toBeGreaterThan(100);
 const ground=await viewPosition(page);await page.keyboard.press('Space');await page.waitForTimeout(220);expect((await viewPosition(page))[1]-ground[1]).toBeGreaterThan(eye*.1);await page.waitForTimeout(900);expect((await viewPosition(page))[1]).toBeCloseTo(ground[1],3);
 await page.keyboard.press('KeyC');expect(ground[1]-(await viewPosition(page))[1]).toBeCloseTo(eye*.38,3);await page.screenshot({path:testInfo.outputPath('real-gs-crouch.png')});await page.keyboard.press('Escape');await page.screenshot({path:testInfo.outputPath('real-gs-pause.png')});
 await testInfo.attach('real-capture-measurements',{body:JSON.stringify({eye,moves,changed,fixtureSha256:'032129e9d9e2df17a5ca1d70aba67b46616fe8ef9e05c0b0d93d54c59aa9eea7',scope:'Public captured object, 8192 exact original Gaussians. Software Chromium. Not full density, walkable environment, native input/GPU certification.'},null,2),contentType:'application/json'});
});
