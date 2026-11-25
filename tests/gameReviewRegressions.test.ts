import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { GameSession, type GameHost } from '../src/game/GameSession';
import { NavigationController } from '../src/render/Navigation';
import {defaultEyeHeight} from '../src/game/entryView';
import {Walker} from '../src/game/locomotion';
import {MeshCollision} from '../src/game/meshCollision';
import {playerScale} from '../src/game/frame';
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
function currentState(){return game.state;}
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

describe('independent review regressions',()=>{
 it('B1 draft height never changes live body/camera; discard restores same stance and pose',async()=>{
  await ready();game.start('keyboard');key('keydown','KeyW');run();key('keyup','KeyW');game.toggleCrouch();const state=game.state;if(state.kind!=='playing')throw Error('run');const walker=state.run.walker,p=host.camera.position.clone(),q=host.camera.quaternion.clone();game.pause();game.adjust();game.configure({eyeHeight:2});expect(walker.standingScale.eyeHeight).toBe(1.7);expect(host.camera.position.toArray()).toEqual(p.toArray());
  game.toggleInspection();key('keydown','KeyR');game.toggleInspection();game.backToPause();expect(game.crouched).toBe(true);expect(host.camera.position.toArray()).toEqual(p.toArray());expect(host.camera.quaternion.angleTo(q)).toBeLessThan(1e-7);game.start('keyboard');expect(game.crouched).toBe(true);
 });
 it('B1 unchanged midair setup resumes same foot/stance/momentum rather than raycast-spawning',async()=>{
  await ready();game.start('keyboard');game.jump();for(let i=0;i<10;i++)game.update(1/60);const p=foot(),q=host.camera.quaternion.clone();game.pause();game.adjust();game.start('keyboard');expect(game.state.kind).toBe('playing');expect(foot().distanceTo(p)).toBeLessThan(1e-8);expect(game.airborne).toBe(true);expect(host.camera.quaternion.angleTo(q)).toBeLessThan(1e-7);game.update(1/60);expect(foot().y).toBeGreaterThan(p.y);
 });
 it('B1 crouched low-ceiling state resumes unchanged and rejected body draft remains cancellable',async()=>{
  await ready();game.start('keyboard');const state=game.state;if(state.kind!=='playing')throw Error('run');
  const floor=(y:number)=>[new THREE.Triangle(new THREE.Vector3(-8,y,-8),new THREE.Vector3(-8,y,8),new THREE.Vector3(8,y,8)),new THREE.Triangle(new THREE.Vector3(-8,y,-8),new THREE.Vector3(8,y,8),new THREE.Vector3(8,y,-8))];
  const scale=playerScale(1.7)!;state.run.walker=new Walker({kind:'mesh',collision:new MeshCollision([...floor(0),...floor(1.4)])},scale,new THREE.Vector3(0,scale.skin,0));expect(state.run.walker.setCrouched(true)).toBe(true);state.run.config.support='mesh';game.update(.01);const p=foot();game.pause();game.adjust();await new Promise(resolve=>setTimeout(resolve,100));game.start('keyboard');expect(game.state.kind).toBe('playing');expect(game.crouched).toBe(true);expect(foot().distanceTo(p)).toBeLessThan(1e-8);
  game.pause();game.adjust();game.configure({eyeHeight:3});game.configure({confirmed:true});game.start('keyboard');expect(game.state.kind).toBe('setup');if(game.state.kind==='setup')expect(game.state.message).toContain('Body clearance');game.backToPause();expect(game.crouched).toBe(true);expect(foot().distanceTo(p)).toBeLessThan(1e-8);
 });
 it('B2 a new capture denial clears stale height feedback',async()=>{
  await ready();game.start('keyboard');game.pause();game.setEyeHeight(1.9);expect(game.feedback).toContain('Eye height');canvas.requestPointerLock=()=>{throw new Error('denied');};game.start('locked');expect(game.state.kind).toBe('paused');expect(game.feedback).toBe('');if(game.state.kind==='paused')expect(game.state.message).toContain('Mouse capture unavailable');
 });
 it('B3 slow crouched movement after body growth is walking, not a fabricated boundary',async()=>{
  await ready();game.start('keyboard');game.setPreferences({speed:.25});game.toggleCrouch();game.setEyeHeight(6);key('keydown','KeyW');run();key('keyup','KeyW');expect(game.motion).toBe('walking');
 });
 it('B3 explicit units calibration rebases huge initial pace without quick-height coupling',async()=>{
  frame.geometry.dispose();frame.geometry=new THREE.PlaneGeometry(2000,2000).rotateX(-Math.PI/2);
  const item=new MeshRenderable('large floor',{fileName:'large.glb',loaderId:'mesh',loadMs:0},frame);host.items=()=>[item];await game.enter();expect(defaultEyeHeight(game.config!.geometry.bounds,new THREE.Vector3(0,1,0))).toBe(160);
  game.configure({eyeHeight:160,support:'mesh',point:new THREE.Vector3()});await new Promise(resolve=>setTimeout(resolve,100));game.configure({confirmed:true});game.start('keyboard');expect(game.state.kind).toBe('playing');if(game.state.kind==='playing')expect(game.state.run.walker.baseSpeed).toBe(272);
  game.pause();expect(game.setEyeHeight(1.7)).toBe(false);game.adjust();game.calibrateScale(1);game.configure({confirmed:true});game.start('keyboard');expect(game.state.kind).toBe('playing');if(game.state.kind==='playing'){expect(game.state.run.walker.baseSpeed).toBeCloseTo(2.89);expect(game.state.run.walker.world.kind).toBe('mesh');expect(game.state.run.walker.standingScale.eyeHeight).toBe(1.7);}

 });
 it('M1 Space-bound reset must not steal a focused button activation while paused',async()=>{
  await ready();game.start('keyboard');game.rebind('jump',['Digit1']);game.rebind('reset',['Space']);game.pause();active=new ElementStub();active.tagName='BUTTON';active.id='game-exit';expect(key('keydown','Space').defaultPrevented).toBe(false);
 });
 it('FPS sensitivity does not stack with unrelated viewer navigation sensitivity',async()=>{
  await ready();nav.sensitivity=2;game.start('locked');for(let i=0;i<2;i++){const e=new Event('mousemove');Object.defineProperties(e,{movementX:{value:10},movementY:{value:0}});doc.dispatchEvent(e);}expect(game.inputTrace).toHaveLength(0);const q=host.camera.quaternion.clone();game.update(.01);expect(host.camera.quaternion.angleTo(q)).toBeCloseTo(.025,5);
 });
});

it('B3 sub-physics refresh ticks retain honest movement feedback instead of alternating boundary',async()=>{await ready();game.start('keyboard');key('keydown','KeyW');for(let i=0;i<20;i++){game.update(1/240);if(i>1)expect(game.motion).toBe('walking');}});

it('B2 real mesh fall recovery replaces fresh jump feedback with its recovery reason',async()=>{
 await ready();game.start('keyboard');if(game.state.kind!=='playing')throw Error('run');const floor=[new THREE.Triangle(new THREE.Vector3(-1,0,-1),new THREE.Vector3(-1,0,1),new THREE.Vector3(1,0,1)),new THREE.Triangle(new THREE.Vector3(-1,0,-1),new THREE.Vector3(1,0,1),new THREE.Vector3(1,0,-1))];game.state.run.walker=Walker.spawn({kind:'mesh',collision:new MeshCollision(floor)},playerScale(1.7)!,new THREE.Vector3())!;game.jump();key('keydown','KeyW');for(let i=0;i<180&&game.state.kind==='playing';i++)game.update(1/60);const ended=currentState();expect(ended.kind).toBe('paused');if(ended.kind==='paused')expect(ended.message).toContain('No safe floor');expect(game.feedback).toBe('');
});

it.each(['KeyR','KeyT'])('setup %s resets only the draft, preserving explored crouch/position/look; play and inspector reset remain functional',async(code)=>{
 await ready();game.start('keyboard');if(code!=='KeyR')expect(game.rebind('reset',[code])).toBe(true);
 key('keydown','KeyW');run();key('keyup','KeyW');key('keydown','ArrowLeft');for(let i=0;i<10;i++)game.update(1/60);key('keyup','ArrowLeft');key('keydown','ArrowUp');for(let i=0;i<5;i++)game.update(1/60);key('keyup','ArrowUp');game.toggleCrouch();
 const live=currentState();if(live.kind!=='playing')throw Error('playing');const p=host.camera.position.clone(),q=host.camera.quaternion.clone(),f=foot();game.pause();game.adjust();game.configure({eyeHeight:2});game.useSelectedSpawn();expect(key('keydown',code).defaultPrevented).toBe(true);key('keyup',code);
 expect(game.state.kind).toBe('setup');expect(live.run.walker.foot.toArray()).toEqual(f.toArray());expect(live.run.walker.crouched).toBe(true);expect(game.config!.eyeHeight).toBe(1.7);expect(host.camera.position.toArray()).toEqual(p.toArray());expect(host.camera.quaternion.angleTo(q)).toBeLessThan(1e-7);
 game.toggleInspection();key('keydown',code);key('keyup',code);game.toggleInspection();game.backToPause();expect(foot().toArray()).toEqual(f.toArray());expect(game.crouched).toBe(true);expect(host.camera.quaternion.angleTo(q)).toBeLessThan(1e-7);
 game.start('keyboard');key('keydown',code);key('keyup',code);expect(foot().distanceTo(live.run.walker.spawn)).toBeLessThan(1e-8);expect(game.crouched).toBe(false);
});
it('Space reset remap leaves focused setup button and summary activation owned by the control',async()=>{
 await ready();game.start('keyboard');game.rebind('jump',['Digit1']);game.rebind('reset',['Space']);key('keydown','KeyW');run();key('keyup','KeyW');game.pause();game.adjust();const p=host.camera.position.clone();
 for(const tag of ['BUTTON','SUMMARY']){active=new ElementStub();active.tagName=tag;active.id='game-back';expect(key('keydown','Space').defaultPrevented).toBe(false);expect(host.camera.position.toArray()).toEqual(p.toArray());expect(game.state.kind).toBe('setup');}
});
