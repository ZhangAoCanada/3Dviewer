import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GameSession, type GameHost } from '../src/game/GameSession';
import { NavigationController } from '../src/render/Navigation';
import { MeshRenderable } from '../src/renderables/meshRenderable';
class ElementStub extends EventTarget {
  tagName = 'CANVAS';
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
      motion(-960,trusted);expect(host.camera.quaternion.angleTo(initial)).toBeLessThan(1e-7);
      expect(game.inputTrace.at(-1)?.disposition).toBe('capture-handoff');
      motion(-960,trusted);expect(host.camera.quaternion.angleTo(initial)).toBeLessThan(1e-7);
      expect(game.inputTrace.at(-1)?.disposition).toBe('discontinuity');expect(game.inputTrace.at(-1)?.appliedDx).toBe(0);
      motion(20,trusted);expect(host.camera.quaternion.angleTo(initial)).toBeGreaterThan(.01);
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
