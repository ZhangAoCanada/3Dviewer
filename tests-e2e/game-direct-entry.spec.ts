import { expect, test } from './test';
import { gameRoom } from './fixtures/gameRoom';
import { instrument, hold, renderFrame, viewPosition, distance, pixels } from './fixtures/fpsProbe';

for(const sample of ['crate','cloud']) test(`Game directly enters rendered FPS and continuous WASD visibly translates ${sample}`,async({page},info)=>{
  await instrument(page);
  await page.goto(`/?sample=${sample}`); await expect(page.locator('#loading')).toBeHidden();
  await page.click('#mode-game');
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');
  await expect(page.locator('#game-panel')).toBeHidden();
  await expect(page.locator('#game-hud-capability')).toContainText('Virtual floor');
  const eye = Number(await page.locator('#game-eye').inputValue());
  if(sample==='crate') {
    const {default:sharp}=await import('sharp');
    const {data,info: image}=await sharp(await pixels(page)).removeAlpha().raw().toBuffer({resolveWithObject:true});
    let colored=0;for(let i=0;i<data.length;i+=image.channels)if(Math.max(data[i]!,data[i+1]!,data[i+2]!)>55 && Math.max(data[i]!,data[i+1]!,data[i+2]!)-Math.min(data[i]!,data[i+1]!,data[i+2]!)>35)colored++;
    // A visible, framed object, not the featureless full-screen wall found in self-review.
    expect(colored/(image.width*image.height)).toBeGreaterThan(.01);
    expect(colored/(image.width*image.height)).toBeLessThan(.7);
  }

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
  const eye=Number(await page.locator('#game-eye').inputValue()); expect(await hold(page,'KeyW')).toBeGreaterThan(eye*.7);await expect(page.locator('#mode-game')).toBeFocused();
  await page.keyboard.press('Escape'); await page.click('#game-start');
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');
  await expect(page.locator('#game-start')).toBeFocused(); expect(await hold(page,'KeyA')).toBeGreaterThan(eye*.7);await expect(page.locator('#game-start')).toBeFocused();
});
test('direct capture denial offers keyboard look; retained fallback button still walks visibly',async({page})=>{
  await instrument(page,true,true);
  await page.goto('/?sample=cloud');await expect(page.locator('#loading')).toBeHidden();await page.click('#mode-game');
  await expect(page.locator('#game-status')).toContainText('Mouse capture unavailable');
  await page.click('#game-keyboard');await expect(page.locator('#game-look-help')).toContainText('Arrows look');await expect(page.locator('#game-keyboard')).toBeFocused();
  const eye=Number(await page.locator('#game-eye').inputValue());expect(await hold(page,'KeyD')).toBeGreaterThan(eye*.7);await expect(page.locator('#game-keyboard')).toBeFocused();
});

for(const scale of [.001,1000]) test(`direct thin facade keeps finite playable entry and visible held movement at scale ${scale}`,async({page})=>{
  await instrument(page);await page.goto('/?sample=crate');await expect(page.locator('#loading')).toBeHidden();
  const vertices=[[-.005,0,-15],[-.005,0,15],[.005,0,15],[.005,0,-15],[-.005,5,-15],[-.005,5,15],[.005,5,15],[.005,5,-15]];
  const obj=vertices.map(v=>'v '+v.map(x=>x*scale).join(' ')).join('\n')+'\nf 1 2 3 4\nf 1 5 6 2\nf 4 3 7 8\nf 1 4 8 5\nf 2 6 7 3\nf 5 8 7 6\n';
  await page.locator('#file-input').setInputFiles({name:'thin-facade.obj',mimeType:'text/plain',buffer:Buffer.from(obj)});
  await expect(page.locator('#file-name')).toHaveText('thin-facade.obj');await page.click('#mode-game');
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');await expect(page.locator('#game-panel')).toBeHidden();
  const eye=Number(await page.locator('#game-eye').inputValue());expect(await hold(page,'KeyW')).toBeGreaterThan(eye*.7);
});
test('verified mesh wall blocks forward motion with feedback while sustained strafe actually moves the camera and scene',async({page})=>{
  await instrument(page);await page.goto('/?sample=crate');await expect(page.locator('#loading')).toBeHidden();
  // A featureless wall fills the view at capsule contact: genuine lateral movement
  // within its span can produce identical pixels. Add vertex-color optical flow,
  // retaining exactly the same vertices/faces, material class and collision world.
  const observableRoom = gameRoom.replace(/^v ([-\d.]+) ([-\d.]+) ([-\d.]+)$/gm,
    (_line: string, x: string, y: string, z: string) => `v ${x} ${y} ${z} ${(Number(x) + 5) / 10} 0.3 ${(5 - Number(x)) / 10}`);
  await page.locator('#file-input').setInputFiles({name:'walk-room.obj',mimeType:'text/plain',buffer:Buffer.from(observableRoom)});
  await expect(page.locator('#file-name')).toHaveText('walk-room.obj');await page.click('#mode-game');
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');await page.keyboard.press('Escape');await page.click('#game-adjust');
  await expect(page.locator('#game-support option[value="mesh"]')).toHaveJSProperty('disabled',false);
  await page.selectOption('#game-support','mesh');await expect(page.locator('#game-candidates-row')).toBeVisible();await page.selectOption('#game-candidates','0');
  await page.fill('#game-eye','1.7');await page.locator('#game-eye').press('Tab');await page.click('#game-selected-spawn');await page.check('#game-confirm');await expect(page.locator('#game-start')).toBeEnabled();await page.click('#game-start');
  await expect.poll(()=>page.evaluate(()=>document.pointerLockElement?.id)).toBe('view');await expect(page.locator('#game-hud-capability')).toContainText('Static mesh');
  const reference='MeshPhongMaterial:modelViewMatrix';
  await renderFrame(page);
  // Consume the first nonzero handoff sample before setting a controlled heading.
  await page.evaluate(()=>document.dispatchEvent(new MouseEvent('mousemove',{movementX:1,movementY:0})));
  await renderFrame(page);
  const m=await page.evaluate(reference=>(Reflect.get(window,'__fpsDraws') as Record<string,number[]>)[reference]!,reference);
  const yaw=Math.atan2(m[2]!,m[10]!);
  // Explicit synthetic relative-look boundary, not a claim of physical mouse certification.
  await page.evaluate(delta=>{
    const parts=Math.max(1,Math.ceil(Math.abs(delta)/100));
    for(let i=0;i<parts;i++) document.dispatchEvent(new MouseEvent('mousemove',{movementX:delta/parts,movementY:0}));
  },yaw/.0025);
  await renderFrame(page);
  const aligned=await page.evaluate(reference=>(Reflect.get(window,'__fpsDraws') as Record<string,number[]>)[reference]!,reference);
  expect(Math.abs(Math.atan2(aligned[2]!,aligned[10]!))).toBeLessThan(.02);
  await page.keyboard.down('KeyW');await expect(page.locator('#game-motion')).toHaveText('Blocked — try strafing');await page.keyboard.up('KeyW');
  const blocked=await viewPosition(page,reference);await page.keyboard.down('KeyW');await page.waitForTimeout(1250);
  await expect(page.locator('#game-motion')).toHaveText('Blocked — try strafing');await page.keyboard.up('KeyW');
  expect(distance(await viewPosition(page,reference),blocked)).toBeLessThan(.05);
  expect(await hold(page,'KeyD',reference)).toBeGreaterThan(1.5);
});
