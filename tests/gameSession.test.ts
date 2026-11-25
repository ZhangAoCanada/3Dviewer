import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GameSession, type GameHost } from '../src/game/GameSession';
import { NavigationController } from '../src/render/Navigation';
import { MeshRenderable } from '../src/renderables/meshRenderable';
class ElementStub extends EventTarget {
  tagName = 'CANVAS';
  id = 'view';
  isContentEditable = false;
  clientWidth = 1000;
  clientHeight = 800;
  focus(): void { focusElement(this); }
  setPointerCapture(): void { }
  releasePointerCapture(): void { }
  requestPointerLock(): Promise<void> { lockElement(this); return Promise.resolve(); }
}
let active: ElementStub, canvas: ElementStub, doc: EventTarget, win: EventTarget, lock: ElementStub | null, modal: boolean;
let host: GameHost, nav: NavigationController, game: GameSession;
let frame: THREE.Mesh;
function focusElement(element: ElementStub): void { active = element; doc.dispatchEvent(new Event('focusin')); }
function lockElement(element: ElementStub): void { lock = element; doc.dispatchEvent(new Event('pointerlockchange')); }
function key(type: string, code: string, repeat = false, modifiers: object = {}) {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, key: { value: code === 'Escape' ? 'Escape' : code }, repeat: { value: repeat }, target: { value: active }, ...Object.fromEntries(Object.entries(modifiers).map(([k, v]) => [k, { value: v }])) });
  win.dispatchEvent(event);
  return event;
}
async function ready() {
  await game.enter();
  expect(game.state.kind).toBe('setup');
  game.configure({ support: 'virtual', eyeHeight: 1.7 });
  game.configure({ confirmed: true });
}
function run() { for (let i = 0; i < 60; i++) {
  nav.update(1 / 60);
  game.update(1 / 60);
} }
function foot(): THREE.Vector3 { const state = game.state; if (state.kind !== 'playing' && state.kind !== 'paused')
  throw new Error('Expected player'); return state.run.walker.foot.clone(); }
beforeEach(() => {
  win = new EventTarget();
  doc = new EventTarget();
  canvas = new ElementStub();
  active = canvas;
  lock = null;
  modal = false;
  Object.defineProperties(doc, { activeElement: { get: () => active }, body: { value: new ElementStub() }, pointerLockElement: { get: () => lock }, hidden: { value: false },
    querySelector: { value: () => modal ? new ElementStub() : null }, exitPointerLock: { value: () => { lock = null; doc.dispatchEvent(new Event('pointerlockchange')); } } });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLElement', ElementStub);
  const camera = new THREE.PerspectiveCamera(55, 1.2, .02, 500);
  camera.position.set(4, 3, 7);
  camera.lookAt(0, 0, 0);
  nav = new NavigationController(camera, canvas as unknown as HTMLElement);
  frame = new THREE.Mesh(new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial());
  const item = new MeshRenderable('floor', { fileName: 'floor.glb', loaderId: 'mesh', loadMs: 0 }, frame);
  host = { camera, canvas: canvas as unknown as HTMLCanvasElement, navigation: nav, scene: new THREE.Scene(), items: () => [item], up: () => 'y', sampleGround: () => new Float32Array(), dirty: () => { } };
  game = new GameSession(host);
});
afterEach(() => { game.dispose(); nav.dispose(); frame.geometry.dispose(); vi.unstubAllGlobals(); });
describe('exclusive game session ownership', () => {
  it('restores exact previous Fly quaternion, position, pivot, clipping and mode', async () => {
    nav.setMode('fly');
    host.camera.lookAt(-8, 6, 2);
    const q = host.camera.quaternion.clone(), position = host.camera.position.clone(), pivot = nav.pivot.clone();
    await ready();
    game.start('keyboard');
    key('keydown', 'KeyW');
    run();
    expect(host.camera.position.distanceTo(position)).toBeGreaterThan(1);
    game.exit();
    expect(host.camera.position.toArray()).toEqual(position.toArray());
    expect(host.camera.quaternion.toArray()).toEqual(q.toArray());
    expect(nav.pivot.toArray()).toEqual(pivot.toArray());
    expect(nav.mode).toBe('fly');
    expect(host.camera.near).toBe(.02);
    expect(host.camera.far).toBe(500);
    const restored = host.camera.position.clone();
    nav.update(.1);
    expect(host.camera.position.toArray()).toEqual(restored.toArray());
  });
  it('only captures mouse after explicit Start and responds to relative yaw/pitch with no roll', async () => {
    await ready();
    expect(lock).toBeNull();
    game.start('locked');
    expect(game.state.kind).toBe('playing');
    expect(lock).toBe(canvas);
    const prior = host.camera.quaternion.clone();
    const mouse = new Event('mousemove');
    Object.defineProperties(mouse, { movementX: { value: 200 }, movementY: { value: 100000 } });
    doc.dispatchEvent(mouse);game.update(.01);
    expect(host.camera.quaternion.angleTo(prior)).toBeLessThan(1e-7);
    for (let i=0;i<4;i++) {
      const normal = new Event('mousemove');Object.defineProperties(normal,{movementX:{value:200},movementY:{value:200}});
      doc.dispatchEvent(normal);game.update(.01);
    }
    expect(host.camera.quaternion.angleTo(prior)).toBeGreaterThan(.1);
    const forward = host.camera.getWorldDirection(new THREE.Vector3());
    expect(Math.abs(forward.y)).toBeLessThan(1);
    expect(Math.abs(forward.y)).toBeGreaterThan(.99);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(host.camera.quaternion);
    expect(Math.abs(right.y)).toBeLessThan(1e-10);
    key('keydown', 'Escape');
    expect(lock).toBeNull();
    expect(game.state.kind).toBe('paused');
  });
  it('does not turn without relative motion; positive dx looks right, positive dy looks down; reset restores entry facing', async () => {
    await ready();game.inputTraceEnabled = true;game.start('locked');
    const initial = host.camera.quaternion.clone();
    const motion = (x: number, y: number) => { const event = new Event('mousemove');Object.defineProperties(event, { movementX: {value:x}, movementY:{value:y} });doc.dispatchEvent(event);game.update(.01); };
    motion(0, 0);expect(host.camera.quaternion.angleTo(initial)).toBeLessThan(1e-7);
    const before = host.camera.getWorldDirection(new THREE.Vector3());
    motion(1, 1);expect(host.camera.quaternion.angleTo(initial)).toBeLessThan(1e-7);
    motion(20, 20);const after = host.camera.getWorldDirection(new THREE.Vector3());
    const right = new THREE.Vector3(1,0,0).applyQuaternion(initial);
    expect(after.dot(right)).toBeGreaterThan(before.dot(right));expect(after.y).toBeLessThan(before.y);
    for(let i=0;i<100;i++)motion(1,0);
    expect(game.inputTrace).toHaveLength(32);expect(game.inputTrace[0]?.event).toBe('capture');expect(game.inputTrace[1]?.dx).toBe(0);
    expect(game.inputTrace.at(-1)?.index).toBe(103);
    game.reset();expect(host.camera.quaternion.angleTo(initial)).toBeLessThan(1e-7);
  });
  it('rejects capture/resume warp impulses and later discontinuities without an isTrusted filter', async () => {
    await ready();game.inputTraceEnabled=true;game.start('locked');
    const motion=(x:number,trusted:boolean)=>{const event=new Event('mousemove');Object.defineProperties(event,{movementX:{value:x},movementY:{value:0},isTrusted:{value:trusted}});doc.dispatchEvent(event);game.update(.01);};
    for(const trusted of [true,false]) {
      const initial=host.camera.quaternion.clone();
      for(let i=0;i<60;i++)motion(0,trusted);
      motion(NaN,trusted);expect(host.camera.quaternion.angleTo(initial)).toBeLessThan(1e-7);
      expect(game.inputTrace.at(-1)?.event).toBe('ignored-nonfinite');
      motion(-960,trusted);expect(host.camera.quaternion.angleTo(initial)).toBeLessThan(1e-7);
      expect(game.inputTrace.at(-1)?.disposition).toBe('capture-handoff');
      motion(-960,trusted);expect(host.camera.quaternion.angleTo(initial)).toBeLessThan(1e-7);
      expect(game.inputTrace.at(-1)?.disposition).toBe('discontinuity');expect(game.inputTrace.at(-1)?.appliedDx).toBe(0);
      motion(20,trusted);expect(host.camera.quaternion.angleTo(initial)).toBeGreaterThan(.01);
      for(let i=0;i<60;i++)motion(1,trusted);expect(game.inputTrace).toHaveLength(32);expect(game.inputTrace.some(row=>row.disposition==='capture-handoff')).toBe(true);
      game.pause();game.start('locked');
    }
  });
  it('owns setup and paused reset commands without abandoning calibration, but leaves editable commands alone', async () => {
    await ready();const reset=vi.spyOn(nav,'reset');
    key('keydown','KeyR');expect(reset).toHaveBeenCalledWith(true);expect(game.state.kind).toBe('setup');
    const input=new ElementStub();input.tagName='INPUT';input.focus();reset.mockClear();expect(key('keydown','KeyR').defaultPrevented).toBe(false);expect(reset).not.toHaveBeenCalled();
    canvas.focus();game.start('keyboard');key('keydown','KeyW');run();game.pause();key('keydown','KeyR');
    expect(foot().toArray()).toEqual([0,0,0]);expect(game.state.kind).toBe('paused');
  });
  it('can render a subtle artificial guide without inventing geometry collision, and can turn it off', async () => {
    await ready();game.start('keyboard');
    let lines=0;host.scene.traverse(o=>{if(o instanceof THREE.LineSegments)lines++;});expect(lines).toBeGreaterThan(0);
    const state=game.state;if(state.kind!=='playing')throw Error('expected playing');expect(state.run.walker.world.kind).toBe('virtual');
    game.exit();await ready();game.configure({showGuide:false});game.start('keyboard');
    lines=0;host.scene.traverse(o=>{if(o instanceof THREE.LineSegments)lines++;});expect(lines).toBe(0);
  });
  it('reports confirmation separately from invalid scale', async () => {
    await game.enter();game.configure({support:'virtual',eyeHeight:1});game.start('keyboard');
    expect(game.state.kind === 'setup' && game.state.message).toContain('Check');
    game.configure({eyeHeight:NaN});game.configure({confirmed:true});game.start('keyboard');
    expect(game.state.kind === 'setup' && game.state.message).toContain('Eye height');
  });
  it('clears held input on focus loss and requires a fresh press on resume', async () => {
    await ready();
    game.start('keyboard');
    key('keydown', 'KeyW');
    run();
    const before = foot();
    new ElementStub().focus();
    expect(game.state.kind).toBe('paused');
    game.update(1);
    expect(foot().toArray()).toEqual(before.toArray());
    game.start('keyboard');
    key('keydown', 'KeyW', true);
    run();
    expect(foot().toArray()).toEqual(before.toArray());
    key('keydown', 'KeyW');
    run();
    expect(foot().distanceTo(before)).toBeGreaterThan(1);
  });
  it('does not capture movement or prevent button/input keys', async () => {
    await ready();
    game.start('keyboard');
    const input = new ElementStub();
    input.tagName = 'INPUT';
    input.focus();
    expect(key('keydown', 'Space').defaultPrevented).toBe(false);
    expect(key('keydown', 'KeyW').defaultPrevented).toBe(false);
    expect(game.state.kind).toBe('paused');
  });
  it('leaves Escape to editable fields and dialogs instead of exiting their game setup', async () => {
    await ready();
    const input = new ElementStub();
    input.tagName = 'INPUT';
    input.focus();
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false);
    expect(game.state.kind).toBe('setup');
    canvas.focus();
    modal = true;
    expect(key('keydown', 'Escape').defaultPrevented).toBe(false);
    expect(game.state.kind).toBe('setup');
  });
  it('pauses on modal even if no focus event, and never resumes by closing it', async () => {
    await ready();
    game.start('keyboard');
    key('keydown', 'KeyW');
    modal = true;
    game.update(.1);
    expect(game.state.kind).toBe('paused');
    const before = foot();
    modal = false;
    run();
    expect(foot().toArray()).toEqual(before.toArray());
  });
  it('does not swallow modifier shortcuts or move with them', async () => {
    await ready();
    game.start('keyboard');
    expect(key('keydown', 'KeyW', false, { ctrlKey: true }).defaultPrevented).toBe(false);
    const before = foot();
    run();
    expect(foot().toArray()).toEqual(before.toArray());
  });
  it('only starts mesh walking after complete asynchronous collision preparation', async () => {
    await game.enter();
    game.configure({ eyeHeight: 1.7 });
    game.configure({ confirmed: true });
    await vi.waitFor(() => expect(game.config?.collisionPreparing).toBe(false));
    game.start('keyboard');
    expect(game.state.kind).toBe('playing');
    expect(foot().y).toBeGreaterThanOrEqual(0);
  });
  it('cancels pending capped collision work on exit without late state attachment', async () => {
    frame.geometry.dispose();
    frame.geometry = new THREE.PlaneGeometry(20, 20, 100, 100).rotateX(-Math.PI / 2);
    await game.enter();
    expect(game.config?.collisionPreparing).toBe(true);
    game.configure({ confirmed: true });
    game.start('keyboard');
    expect(game.state.kind).toBe('setup');
    game.exit();
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(game.state.kind).toBe('inactive');
    expect(lock).toBeNull();
  });
  it('never enters playing merely because lock was requested or denied', async () => {
    await ready();
    canvas.requestPointerLock = () => Promise.reject(new Error('denied'));
    game.start('locked');
    expect(game.state.kind).toBe('acquiring');
    await Promise.resolve();
    expect(game.state.kind).toBe('paused');
    expect(lock).toBeNull();
  });
  it('cancelled preparation cannot attach a stale proposal or touch a replacement camera', async () => {
    let release: (() => void) | null = null;
    game.suggestions = () => new Promise(resolve => { release = () => resolve({suggestions:[{ normal: new THREE.Vector3(0, 1, 0), point: new THREE.Vector3(), evidence: 'late' }],message:''}); });
    const pending = game.enter();
    while (!release)
      await new Promise(resolve => setTimeout(resolve, 1));
    game.invalidate();
    host.camera.position.set(9, 9, 9);
    const done: () => void = release;
    done();
    await pending;
    expect(game.state.kind).toBe('inactive');
    expect(host.camera.position.toArray()).toEqual([9, 9, 9]);
  });
  it('setup selection and clear dispose owned preview geometries and release lock', async () => {
    await ready();
    const geometries: THREE.BufferGeometry[] = [];
    host.scene.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments)
      geometries.push(o.geometry); });
    const disposals = geometries.map(g => { let disposed = false; g.addEventListener('dispose', () => { disposed = true; }); return () => disposed; });
    game.start('locked');
    expect(disposals.every(check => check())).toBe(true);
    game.invalidate();
    expect(lock).toBeNull();
    expect(game.state.kind).toBe('inactive');
  });
  it('preparing cancellation is safe and idempotent', async () => {
    const pending = game.enter();
    game.exit();
    game.exit();
    await pending;
    expect(game.state.kind).toBe('inactive');
  });
});

describe('direct FPS entry and retained entry-control focus', () => {
  function retainButton(id: string) {
    const button = new ElementStub(); button.tagName = 'BUTTON'; button.id = id; active = button;
    vi.spyOn(canvas, 'focus').mockImplementation(() => {});
    return button;
  }
  for (const id of ['mode-game', 'game-start', 'game-keyboard']) it(`holds WASD with retained ${id} focus and actual canvas pointer capture, including resume`, async () => {
    await ready(); retainButton(id); game.start('locked');
    expect(lock).toBe(canvas);
    for (const code of ['KeyW', 'KeyA', 'KeyD']) {
      const before = host.camera.position.clone(); key('keydown', code); run(); key('keyup', code);
      expect(game.state.kind).toBe('playing'); expect(host.camera.position.distanceTo(before)).toBeGreaterThan(1.2);
    }
    game.pause(); game.start('locked'); key('keydown','KeyW'); const before = foot(); run(); key('keyup','KeyW');
    expect(foot().distanceTo(before)).toBeGreaterThan(1.2); expect(game.motion).toBe('walking');
  });
  it('keyboard look retains its own entry button without capturing arbitrary outside controls', async () => {
    await ready(); retainButton('game-keyboard'); game.start('keyboard'); const before = foot();
    key('keydown','KeyW'); run(); key('keyup','KeyW'); expect(foot().distanceTo(before)).toBeGreaterThan(1.2);
    const other = new ElementStub(); other.tagName='BUTTON'; other.id='settings'; focusElement(other); expect(game.state.kind).toBe('paused');
  });
  it('pointer lock does not override editable focus or modal intent', async () => {
    await ready(); game.start('locked'); const input = new ElementStub(); input.tagName='INPUT'; focusElement(input);
    expect(game.state.kind).toBe('paused'); expect(lock).toBeNull();
    game.start('locked'); modal=true; key('keydown','KeyW'); game.update(1/60); expect(game.state.kind).toBe('paused');
  });
  it('direct Game requests capture synchronously, without detector readiness or setup acknowledgement', () => {
    let analyse: (() => void) | undefined;
    game.suggestions = () => new Promise(resolve => { analyse = () => resolve({suggestions:[],message:''}); });
    game.enterDirect();
    const before = host.camera.position.clone();
    expect(lock).toBe(canvas); expect(game.state.kind).toBe('playing'); expect(game.config?.confirmed).toBe(true);
    expect(game.config?.support).toBe('virtual');
    key('keydown','KeyW'); run(); key('keyup','KeyW'); expect(host.camera.position.distanceTo(before)).toBeGreaterThan(1);
    analyse?.(); game.exit();
  });
  it('direct entry into thin vertical content has usable finite walking room, not a rejected spawn', () => {
    frame.geometry.dispose(); frame.geometry = new THREE.BoxGeometry(.001, 5, 30);
    game.enterDirect(); expect(game.state.kind).toBe('playing');
    if (game.state.kind !== 'playing') throw Error('No direct player');
    const before = foot(); key('keydown','KeyA'); run(); key('keyup','KeyA');
    expect(foot().distanceTo(before)).toBeGreaterThan(game.state.run.walker.scale.eyeHeight);
    expect(game.state.run.walker.world.kind).toBe('virtual');
  });
  it('reports real finite-boundary blocking separately from actual translation', async () => {
    await ready(); game.start('keyboard');
    if(game.state.kind !== 'playing') throw Error('No player');
    const {walker}=game.state.run; if(walker.world.kind!=='virtual')throw Error('No finite floor');
    const f=walker.world.footprint; walker.foot.set(f.maxX-walker.scale.radius,0,f.minZ+walker.scale.radius);
    key('keydown','KeyW');key('keydown','KeyD');run();key('keyup','KeyW');key('keyup','KeyD');
    expect(game.motion).toBe('boundary');
  });
});

it('prepares verified mesh opportunistically without changing the active virtual walk, then reuses it on next entry', async () => {
  game.suggestions = async () => ({ suggestions:[{point:new THREE.Vector3(),normal:new THREE.Vector3(0,1,0),evidence:'Synthetic floor hypothesis'}],message:'' });
  game.enterDirect(); expect(game.config?.support).toBe('virtual'); const initial = host.camera.position.clone();
  await vi.waitFor(() => expect(game.config?.suggestions).toHaveLength(1));
  expect(game.config?.support).toBe('virtual');expect(host.camera.position.toArray()).toEqual(initial.toArray());
  game.exit();game.enterDirect();expect(game.config?.support).toBe('mesh');expect(game.state.kind).toBe('playing');
  key('keydown','KeyW');const before=host.camera.position.clone();run();key('keyup','KeyW');
  expect(host.camera.position.distanceTo(before)).toBeGreaterThan(1);
});
it('scene invalidation aborts opportunistic analysis and cannot apply its late plane to a replacement', async () => {
  let finish: (()=>void) | undefined;
  game.suggestions = () => new Promise(resolve=>{finish=()=>resolve({suggestions:[{point:new THREE.Vector3(0,500,0),normal:new THREE.Vector3(0,1,0),evidence:'Stale scene'}],message:''});});
  game.enterDirect();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
  game.invalidate();finish!();await new Promise(resolve=>setTimeout(resolve,10));
  expect(game.state.kind).toBe('inactive');game.suggestions=null;game.enterDirect();expect(game.config?.suggestions).toHaveLength(0);expect(game.config?.point.y).toBeCloseTo(0,10);
});

it('late pointer capture cannot steal an editable focus or modal opened during acquisition', async () => {
  await ready();vi.spyOn(canvas,'requestPointerLock').mockResolvedValue();game.start('locked');
  expect(game.state.kind).toBe('acquiring');const input=new ElementStub();input.tagName='INPUT';focusElement(input);lockElement(canvas);
  expect(game.state.kind).toBe('paused');expect(active).toBe(input);expect(lock).toBeNull();
});

describe('non-destructive refinement controls',()=>{
 it('eye height and floor offset preserve explored XZ, look and independent speed',async()=>{
  await ready();game.start('keyboard');key('keydown','KeyW');run();key('keyup','KeyW');
  const before=foot(),q=host.camera.quaternion.clone();const s=game.state;if(s.kind!=='playing')throw Error('run');const speed=s.run.walker.baseSpeed;
  game.pause();expect(game.setEyeHeight(1.9)).toBe(true);expect(foot().toArray()).toEqual(before.toArray());expect(host.camera.quaternion.angleTo(q)).toBeLessThan(1e-7);expect(s.run.walker.baseSpeed).toBe(speed);
  const origin=s.run.frame.origin.clone();expect(game.setFloorOffset(game.floorOffset+.3)).toBe(true);expect(s.run.frame.origin.y-origin.y).toBeCloseTo(.3);expect(foot().toArray()).toEqual(before.toArray());
  game.start('keyboard');const resumed=foot();key('keydown','KeyD');run();key('keyup','KeyD');expect(foot().distanceTo(resumed)).toBeCloseTo(speed,5);
 });
 it('advanced setup keeps current camera and resumes unchanged position/look rather than original orbit',async()=>{
  await ready();game.start('keyboard');key('keydown','KeyW');run();key('keyup','KeyW');const p=host.camera.position.clone(),q=host.camera.quaternion.clone(),f=foot();
  game.pause();game.adjust();expect(game.ownsCamera).toBe(true);expect(host.camera.position.equals(p)).toBe(true);game.configure({eyeHeight:1.8});game.configure({confirmed:true});game.start('keyboard');expect(foot().distanceTo(f)).toBeLessThan(1e-7);expect(host.camera.quaternion.angleTo(q)).toBeLessThan(1e-7);
 });
 it('live resize/floor edits reject airborne/invalid changes without corrupting pose',async()=>{
  await ready();game.start('keyboard');game.jump();game.update(.03);const p=foot(),q=host.camera.quaternion.clone();expect(game.setEyeHeight(NaN)).toBe(false);expect(game.setEyeHeight(2)).toBe(false);expect(game.setFloorOffset(.2)).toBe(false);expect(foot().equals(p)).toBe(true);expect(host.camera.quaternion.angleTo(q)).toBeLessThan(1e-7);
 });
 it('Space/Enter retained-button defaults are owned without implicit recapture or exit',async()=>{
  await ready();game.start('locked');const button=new ElementStub();button.id='mode-game';button.tagName='BUTTON';focusElement(button);
  for(const code of ['Space','Enter']) {expect(key('keydown',code).defaultPrevented).toBe(true);key('keyup',code);expect(game.playing).toBe(true);expect(lock).toBe(canvas);}
 });
});

it('tilted/non-Y-up live height and virtual floor follow chosen up without XZ/look loss',async()=>{
 await ready();const up=new THREE.Vector3(.2,.1,1).normalize();game.configure({normal:up});game.configure({confirmed:true});game.start('keyboard');key('keydown','KeyD');run();key('keyup','KeyD');
 const p=host.camera.position.clone(),q=host.camera.quaternion.clone(),f=foot();game.pause();expect(game.setEyeHeight(1.9)).toBe(true);expect(host.camera.position.clone().sub(p).distanceTo(up.clone().multiplyScalar(.2))).toBeLessThan(1e-7);
 const after=host.camera.position.clone();expect(game.setFloorOffset(game.floorOffset+.4)).toBe(true);expect(host.camera.position.clone().sub(after).distanceTo(up.clone().multiplyScalar(.4))).toBeLessThan(1e-7);expect(foot().distanceTo(f)).toBeLessThan(1e-7);expect(host.camera.quaternion.angleTo(q)).toBeLessThan(1e-7);
});

describe('expanded action ownership and pose changes',()=>{
 it('jump is fresh-edge only and held repeat never launches again after landing',async()=>{
  await ready();game.start('keyboard');const y=foot().y;expect(key('keydown','Space').defaultPrevented).toBe(true);for(let i=0;i<15;i++)game.update(1/60);expect(foot().y-y).toBeGreaterThan(.2);
  run();expect(foot().y).toBeCloseTo(y,8);key('keydown','Space',true);run();expect(foot().y).toBeCloseTo(y,8);
  key('keyup','Space');key('keydown','Space');game.update(.1);expect(foot().y-y).toBeGreaterThan(.1);
 });
 it('remaps movement/jump/reset without stealing modified chords or editable intent, Escape remains recovery',async()=>{
  await ready();game.start('locked');expect(game.rebind('moveForward',['KeyI'])).toBe(true);expect(game.rebind('jump',['Digit1'])).toBe(true);expect(game.rebind('reset',['KeyT'])).toBe(true);
  const before=foot();key('keydown','KeyW');run();expect(foot().distanceTo(before)).toBeLessThan(1e-8);
  expect(key('keydown','KeyI',false,{ctrlKey:true}).defaultPrevented).toBe(false);run();expect(foot().distanceTo(before)).toBeLessThan(1e-8);
  key('keydown','KeyI');run();key('keyup','KeyI');expect(foot().distanceTo(before)).toBeGreaterThan(1.2);
  expect(key('keydown','Digit1').defaultPrevented).toBe(true);game.update(.1);expect(foot().y).toBeGreaterThan(.1);
  key('keydown','KeyT');expect(foot().distanceTo(before)).toBeLessThan(1e-8);expect(game.state.kind).toBe('playing');
  key('keydown','Escape');expect(game.state.kind).toBe('paused');expect(game.rebind('jump',['Escape'])).toBe(false);expect(game.rebind('jump',['KeyI'])).toBe(false);
  const edit=new ElementStub();edit.tagName='INPUT';focusElement(edit);expect(key('keydown','KeyT').defaultPrevented).toBe(false);expect(game.state.kind).toBe('paused');
 });
 it('crouch/height/floor keys do not repeat and setup pick/cancel never yields explored camera to navigation',async()=>{
  await ready();game.start('keyboard');const p=foot(),q=host.camera.quaternion.clone();key('keydown','KeyC');expect(game.crouched).toBe(true);key('keydown','KeyC',true);expect(game.crouched).toBe(true);
  key('keydown','BracketRight');expect(game.config!.eyeHeight).toBeCloseTo(1.7*1.15);const eye=game.config!.eyeHeight;key('keydown','BracketRight',true);expect(game.config!.eyeHeight).toBe(eye);expect(foot().distanceTo(p)).toBeLessThan(1e-8);expect(host.camera.quaternion.angleTo(q)).toBeLessThan(1e-7);
  game.pause();game.adjust();game.pickFloor();game.escape();const saved=host.camera.position.clone();nav.update(.5);expect(host.camera.position.toArray()).toEqual(saved.toArray());expect(game.ownsCamera).toBe(true);
 });
});

it('owns retained-button activation and fresh game intent while pointer lock confirmation is pending',async()=>{
 await ready();canvas.requestPointerLock=()=>Promise.resolve();active=new ElementStub();active.tagName='BUTTON';active.id='game-start';canvas.focus=()=>{};game.start('locked');expect(game.state.kind).toBe('acquiring');
 expect(key('keydown','Enter').defaultPrevented).toBe(true);expect(key('keydown','Space').defaultPrevented).toBe(true);key('keyup','Space');key('keydown','KeyW');const before=host.camera.position.clone();game.update(.05);expect(host.camera.position.toArray()).toEqual(before.toArray());
 lockElement(canvas);game.update(.05);expect(game.state.kind).toBe('playing');expect(foot().y).toBeGreaterThan(.01);expect(host.camera.position.distanceTo(before)).toBeGreaterThan(.01);
});

it('denied pending capture cancels queued jump/crouch instead of resuming an unseen airborne stance',async()=>{
 await ready();canvas.requestPointerLock=()=>Promise.resolve();game.start('locked');key('keydown','Space');key('keydown','KeyC');expect(game.airborne).toBe(false);expect(game.crouched).toBe(false);doc.dispatchEvent(new Event('pointerlockerror'));expect(game.state.kind).toBe('paused');game.start('keyboard');run();expect(game.airborne).toBe(false);expect(game.crouched).toBe(false);expect(foot().y).toBe(0);
});

it('advanced draft surface changes cannot mutate the explored live world before validated commit',async()=>{
 await ready();game.start('keyboard');if(game.state.kind!=='playing')throw Error('playing');const live=game.state.run,point=live.config.point.clone(),normal=live.config.normal.clone(),pose=host.camera.position.clone();game.pause();game.adjust();expect(game.config).not.toBe(live.config);
 game.configure({point:new THREE.Vector3(0,9,0),normal:new THREE.Vector3(0,0,1)});expect(live.config.point.toArray()).toEqual(point.toArray());expect(live.config.normal.toArray()).toEqual(normal.toArray());expect(host.camera.position.toArray()).toEqual(pose.toArray());
 game.setBindingCapture(true);game.invalidate();expect(game.capturingBinding).toBe(false);
});
