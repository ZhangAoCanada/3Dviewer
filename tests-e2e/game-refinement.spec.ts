import {test,expect} from './test';
import {instrument,hold,viewPosition,renderFrame,distance,pixels,observeRenderedPose,renderedPoseObservation,canvasInteriorPixels} from './fixtures/fpsProbe';
import {gameTunnel} from './fixtures/gameTunnel';
const reference='PointsMaterial:modelViewMatrix';
async function orientation(page:import('@playwright/test').Page) {
 await renderFrame(page);return page.evaluate(reference=> (Reflect.get(window,'__fpsDraws') as Record<string,number[]>)[reference]!.slice(0,12),reference);
}
test('Pause height/floor controls preserve explored position/look and independent actual walk speed',async({page})=>{
 await instrument(page);await page.goto('/?sample=cloud');await expect(page.locator('#loading')).toBeHidden();await page.click('#mode-game');
 await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');await expect(page.locator('#game-panel')).toBeHidden();
 const baseline=await hold(page,'KeyW',reference);expect(baseline).toBeGreaterThan(.1);
 const before=await viewPosition(page,reference), rotation=await orientation(page), eye=Number(await page.locator('#game-eye').inputValue());
 await page.keyboard.press('Escape');await expect(page.locator('#game-paused')).toBeVisible();await page.fill('#game-quick-eye',String(eye*1.15));await page.click('#game-eye-apply');
 const taller=await viewPosition(page,reference);expect(Math.hypot(taller[0]-before[0],taller[2]-before[2])).toBeLessThan(1e-5);expect(taller[1]-before[1]).toBeCloseTo(eye*.15,4);expect(await orientation(page)).toEqual(rotation);
 const floor=Number(await page.locator('#game-quick-floor').inputValue());await page.fill('#game-quick-floor',String(floor+eye*.25));await page.click('#game-floor-apply');
 const shifted=await viewPosition(page,reference);expect(Math.hypot(shifted[0]-taller[0],shifted[2]-taller[2])).toBeLessThan(1e-5);expect(shifted[1]-taller[1]).toBeCloseTo(eye*.25,4);expect(await orientation(page)).toEqual(rotation);
 await page.click('#game-start');const normal=await hold(page,'KeyD',reference);expect(normal/baseline).toBeGreaterThan(.75);expect(normal/baseline).toBeLessThan(1.3);
 await page.keyboard.press('Escape');await page.locator('#game-speed').fill('2');await page.locator('#game-speed').dispatchEvent('input');await page.click('#game-start');const fast=await hold(page,'KeyA',reference);expect(fast/normal).toBeGreaterThan(1.5);expect(fast/normal).toBeLessThan(2.5);
 await page.keyboard.press('Escape');const p=await viewPosition(page,reference);await page.click('#game-adjust');await expect(page.locator('#game-setup')).toBeVisible();expect(distance(await viewPosition(page,reference),p)).toBeLessThan(1e-5);await page.click('#game-start');expect(distance(await viewPosition(page,reference),p)).toBeLessThan(1e-5);
});
for(const width of [360,640,1280])test(`compact controls remain reachable at ${width}`,async({page})=>{
 await page.setViewportSize({width,height:800});await page.goto('/?sample=cloud');await expect(page.locator('#loading')).toBeHidden();await page.click('#mode-game');await expect(page.locator('.game-hud')).toBeVisible();
 const hint=await page.locator('.game-instructions').boundingBox(),cross=await page.locator('.game-crosshair').boundingBox();expect(hint).not.toBeNull();expect(cross).not.toBeNull();expect(hint!.y+hint!.height).toBeLessThan(cross!.y);
 await page.keyboard.press('Escape');await expect(page.locator('#game-paused')).toBeVisible();expect(await page.locator('#game-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
 await page.locator('#game-start').scrollIntoViewIfNeeded();await expect(page.locator('#game-start')).toBeVisible();await page.locator('#game-start').focus();await page.keyboard.press('Tab');await expect(page.locator('#game-keyboard')).toBeFocused();
});
test('retained entry Space/Enter never fire a default button click',async({page})=>{
 await instrument(page,true);await page.goto('/?sample=cloud');await expect(page.locator('#loading')).toBeHidden();await page.click('#mode-game');await expect(page.locator('#mode-game')).toBeFocused();
 for(const key of ['Space','Enter']){await page.keyboard.press(key);await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');await expect(page.locator('#game-panel')).toBeHidden();}
});

test('Space is a fresh grounded virtual hop, not held-repeat flight; crouch and height shortcuts change rendered pose',async({page})=>{
 await instrument(page,true);await page.goto('/?sample=cloud');await expect(page.locator('#loading')).toBeHidden();await page.click('#mode-game');await expect(page.locator('#mode-game')).toBeFocused();
 const eye=Number(await page.locator('#game-eye').inputValue()),ground=await viewPosition(page,reference),image=await pixels(page);
 await observeRenderedPose(page,reference,ground[1]+eye*.15);expect((await renderedPoseObservation(page)).lastY).toBeCloseTo(ground[1],5);
 await page.keyboard.down('Space');await page.waitForTimeout(260);await expect.poll(async()=>(await renderedPoseObservation(page)).png).toMatch(/^data:image\/png;base64,/);const airborne=await renderedPoseObservation(page);expect(airborne.pngY!-ground[1]).toBeGreaterThan(eye*.15);expect((await canvasInteriorPixels(Buffer.from(airborne.png!.split(',')[1]!,'base64'))).equals(await canvasInteriorPixels(image))).toBe(false);
 await page.keyboard.down('Space');await expect.poll(async()=>Math.abs((await viewPosition(page,reference))[1]-ground[1])).toBeLessThan(eye*.02);
 await observeRenderedPose(page,reference);await page.keyboard.down('Space');await page.waitForTimeout(200);expect((await renderedPoseObservation(page)).maxY-ground[1]).toBeLessThan(eye*.02);expect(Math.abs((await viewPosition(page,reference))[1]-ground[1])).toBeLessThan(eye*.02);await page.keyboard.up('Space');
 await page.keyboard.press('KeyC');await renderFrame(page);expect(ground[1]-(await viewPosition(page,reference))[1]).toBeCloseTo(eye*.38,4);
 await page.keyboard.press('KeyC');await expect.poll(async()=>Math.abs((await viewPosition(page,reference))[1]-ground[1])).toBeLessThan(eye*.02);
 await page.keyboard.press('BracketRight');const grown=await viewPosition(page,reference);expect(grown[1]-ground[1]).toBeCloseTo(eye*.15,4);
 await page.keyboard.press('PageUp');const shifted=await viewPosition(page,reference);expect(shifted[1]-grown[1]).toBeCloseTo(eye*1.15*.25,4);
 await page.keyboard.press('Slash');await expect(page.locator('#game-controls')).toHaveAttribute('open','');await expect(page.locator('#game-paused')).toBeVisible();await expect(page.locator('#game-current-keys')).toContainText('Space');
});
async function meshSetup(page:import('@playwright/test').Page,ceiling=false){
 await instrument(page);await page.goto('/?sample=crate');await expect(page.locator('#loading')).toBeHidden();await page.locator('#file-input').setInputFiles({name:'observable-tunnel.obj',mimeType:'text/plain',buffer:Buffer.from(gameTunnel(ceiling))});
 await expect(page.locator('#file-name')).toHaveText('observable-tunnel.obj');await page.click('#mode-game');await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');await page.keyboard.press('Escape');await page.click('#game-adjust');await page.selectOption('#game-support','mesh');await page.selectOption('#game-candidates','0');await page.fill('#game-eye','1.7');await page.locator('#game-eye').press('Tab');await page.click('#game-selected-spawn');await page.check('#game-confirm');await expect(page.locator('#game-start')).toBeEnabled();await page.click('#game-start');await expect(page.locator('#game-hud-capability')).toContainText('Static mesh');
 const ref='MeshPhongMaterial:modelViewMatrix';await renderFrame(page);await page.evaluate(()=>document.dispatchEvent(new MouseEvent('mousemove',{movementX:1,movementY:0})));
 const m=await page.evaluate(ref=>(Reflect.get(window,'__fpsDraws') as Record<string,number[]>)[ref]!,ref);const yaw=Math.atan2(m[2]!,m[10]!);
 await page.evaluate(delta=>{const n=Math.max(1,Math.ceil(Math.abs(delta)/100));for(let i=0;i<n;i++)document.dispatchEvent(new MouseEvent('mousemove',{movementX:delta/n,movementY:0}));},yaw/.0025);await renderFrame(page);return ref;
}
test('actual mesh jump lands and crouched capsule passes tunnel while uncrouch/growth are refused underneath',async({page})=>{
 const ref=await meshSetup(page),spawn=await viewPosition(page,ref);await observeRenderedPose(page,ref);expect((await renderedPoseObservation(page)).lastY).toBeCloseTo(spawn[1],5);await page.keyboard.press('Space');await page.waitForTimeout(260);await expect.poll(async()=>(await renderedPoseObservation(page)).maxY-spawn[1]).toBeGreaterThan(.2);await expect.poll(async()=>Math.abs((await viewPosition(page,ref))[1]-spawn[1])).toBeLessThan(.01);
 await page.keyboard.down('KeyD');await page.waitForTimeout(1250);await page.keyboard.up('KeyD');const blocked=await viewPosition(page,ref);expect(blocked[0]-spawn[0]).toBeLessThan(1.1);
 await page.keyboard.press('KeyC');const image=await pixels(page);await page.keyboard.down('KeyD');await page.waitForTimeout(1250);await page.keyboard.up('KeyD');const inside=await viewPosition(page,ref);expect(inside[0]-blocked[0]).toBeGreaterThan(1);expect((await pixels(page)).equals(image)).toBe(false);
 await page.keyboard.press('KeyC');await expect(page.locator('#game-motion')).toContainText('staying crouched');expect((await viewPosition(page,ref))[1]).toBeCloseTo(inside[1],3);
 await page.keyboard.press('Escape');await page.click('#game-adjust');await page.click('#game-start');await expect(page.locator('.game-hud')).toBeVisible();expect((await viewPosition(page,ref))[1]).toBeCloseTo(inside[1],3);await page.keyboard.press('KeyC');await expect(page.locator('#game-motion')).toContainText('staying crouched');await page.keyboard.press('Escape');await page.fill('#game-quick-eye','3');await page.click('#game-eye-apply');await expect(page.locator('#game-status')).toContainText('Height unchanged');await expect(page.locator('#game-quick-eye')).toHaveValue('1.7');
 await page.click('#game-start');await page.keyboard.down('KeyA');await page.waitForTimeout(2300);await page.keyboard.up('KeyA');await page.keyboard.press('KeyC');await expect.poll(async()=>(await viewPosition(page,ref))[1]-inside[1]).toBeGreaterThan(.5);
});
test('actual mesh ceiling bounds jump with no tunneling; virtual support stays explicitly ceiling-free',async({page})=>{
 const ref=await meshSetup(page,true),spawn=await viewPosition(page,ref);
 await observeRenderedPose(page,ref);expect((await renderedPoseObservation(page)).lastY).toBeCloseTo(spawn[1],5);
 await page.keyboard.press('Space');let apex=0;
 for(let i=0;i<10;i++){await page.waitForTimeout(40);apex=Math.max(apex,(await viewPosition(page,ref))[1]-spawn[1]);}
 const uploaded=await renderedPoseObservation(page);expect(uploaded.samples).toBeGreaterThan(0);apex=Math.max(apex,uploaded.maxY-spawn[1]);expect(apex).toBeGreaterThan(.01);expect(apex).toBeLessThan(.16);await expect.poll(async()=>Math.abs((await viewPosition(page,ref))[1]-spawn[1])).toBeLessThan(.01);
});

test('optional key capture rejects conflicts, cancels safely, persists valid remaps and renders actual held movement/jump',async({page})=>{
 await instrument(page,true);await page.goto('/?sample=cloud');await expect(page.locator('#loading')).toBeHidden();await page.click('#mode-game');await page.keyboard.press('Escape');await page.locator('#game-bindings summary').click();
 await page.click('#game-bind-moveForward');await page.keyboard.press('KeyI');await expect(page.locator('#game-binding-moveForward')).toHaveText('I');
 await page.click('#game-bind-jump');await page.keyboard.press('KeyC');await expect(page.locator('#game-binding-status')).toContainText('conflicts');await expect(page.locator('#game-binding-jump')).toHaveText('Space');
 await page.click('#game-bind-jump');await page.keyboard.press('Escape');await expect(page.locator('#game-paused')).toBeVisible();await expect(page.locator('#game-binding-jump')).toHaveText('Space');
 await page.click('#game-bind-jump');await page.keyboard.press('Digit1');await expect(page.locator('#game-binding-jump')).toHaveText('1');
 await page.click('#game-bind-crouch');await page.keyboard.press('Tab');await expect(page.locator('#game-bind-cancel')).toBeHidden();await expect(page.locator('#game-paused')).toBeVisible();
 await page.click('#game-controls summary');await expect(page.locator('#game-current-keys')).toContainText('I: Move forward');await expect(page.locator('#game-current-keys')).toContainText('1: Jump');
 await page.click('#game-start');await expect(page.locator('#game-start')).toBeFocused();const spawn=await viewPosition(page,reference);const moved=await hold(page,'KeyI',reference);expect(moved).toBeGreaterThan(.1);
 const stopped=await viewPosition(page,reference);await page.keyboard.down('KeyW');await page.waitForTimeout(1250);await page.keyboard.up('KeyW');expect(distance(await viewPosition(page,reference),stopped)).toBeLessThan(1e-4);
 await page.keyboard.press('Digit1');await page.waitForTimeout(220);expect((await viewPosition(page,reference))[1]-spawn[1]).toBeGreaterThan(.01);await expect(page.locator('.game-hud')).toBeVisible();await page.keyboard.press('Escape');await page.click('#game-exit');
 await page.reload();await expect(page.locator('#loading')).toBeHidden();await page.click('#mode-game');await page.keyboard.press('Escape');await page.locator('#game-bindings summary').click();await expect(page.locator('#game-binding-moveForward')).toHaveText('I');await expect(page.locator('#game-binding-jump')).toHaveText('1');
 await page.click('#game-bindings-reset');await expect(page.locator('#game-binding-moveForward')).toHaveText('W');await expect(page.locator('#game-binding-jump')).toHaveText('Space');
});
test('binding capture yields to actual editables; malformed saved bindings/comfort settings remain recoverable defaults',async({page})=>{
 await page.addInitScript(()=>{localStorage.setItem('omniview-fps-keys-v1','{"version":999,"bindings":{}}');localStorage.setItem('omniview-fps-preferences-v1','{"version":1,"speed":100000}');});
 await instrument(page);await page.goto('/?sample=cloud');await expect(page.locator('#loading')).toBeHidden();await page.click('#mode-game');await page.keyboard.press('Escape');await page.locator('#game-bindings summary').click();await expect(page.locator('#game-binding-status')).toContainText('using defaults');
 await page.click('#game-bind-moveForward');await page.locator('#game-quick-eye').focus();await page.locator('#game-quick-eye').fill('0.5');await expect(page.locator('#game-bind-cancel')).toBeHidden();await expect(page.locator('#game-binding-moveForward')).toHaveText('W');
 await page.locator('#game-controls summary').click();await page.locator('#game-look-sensitivity').fill('1.5');await page.check('#game-reduced-motion');await expect(page.locator('#game-look-value')).toHaveText('1.5×');await expect(page.locator('#game-speed-value')).toHaveText('1×');
 await page.click('#game-keyboard');const before=await orientation(page);await page.keyboard.down('ArrowLeft');await page.waitForTimeout(400);await page.keyboard.up('ArrowLeft');expect(await orientation(page)).not.toEqual(before);const p=await viewPosition(page,reference);await page.keyboard.press('KeyC');await renderFrame(page);expect((await viewPosition(page,reference))[1]).toBeLessThan(p[1]);
});
