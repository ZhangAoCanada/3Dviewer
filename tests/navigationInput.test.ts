import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NavigationController } from '../src/render/Navigation';

class ElementStub extends EventTarget {
  tagName = 'CANVAS';
  isContentEditable = false;
  clientHeight = 800;
  clientWidth = 1200;
  focus(): void { focusElement(this); }
  setPointerCapture(): void {}
}
let active: ElementStub;
let doc: EventTarget;
let win: EventTarget;
let modal = false;
let nav: NavigationController;
let camera: THREE.PerspectiveCamera;
let canvas: ElementStub;

function focusElement(element: ElementStub): void {
  active = element;
  doc.dispatchEvent(new Event('focusin'));
}

function key(code: string, target = active, prevented = false, repeat = false): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, target: { value: target }, repeat: { value: repeat } });
  if (prevented) event.preventDefault();
  win.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  win = new EventTarget(); doc = new EventTarget(); canvas = new ElementStub(); active = canvas; modal = false;
  Object.defineProperties(doc, {
    activeElement: { get: () => active }, body: { value: new ElementStub() },
    querySelector: { value: () => modal ? new ElementStub() : null },
  });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('HTMLElement', ElementStub);
  camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1000);
  camera.position.set(0, 0, 10); camera.lookAt(0, 0, 0);
  // DOM boundary double. Camera and controller behavior are real.
  nav = new NavigationController(camera, canvas as unknown as HTMLElement);
});
afterEach(() => { nav.dispose(); vi.unstubAllGlobals(); });

describe('navigation input ownership', () => {
  it('restores Fly quaternion/up/projection after a game exit and later reload snapshot, not lookAt stale pivot', () => {
    const camera = new THREE.PerspectiveCamera(61, 1, .007, 900);
    const element = new ElementStub();
    const controller = new NavigationController(camera, element as unknown as HTMLElement);
    controller.setMode('fly');camera.position.set(4,3,7);camera.quaternion.setFromEuler(new THREE.Euler(-.4,1.1,0,'YXZ'));
    const snapshot=controller.snapshot(), expected=camera.quaternion.clone();
    controller.frame(new THREE.Box3(new THREE.Vector3(-5,-5,-5),new THREE.Vector3(5,5,5)));
    controller.restore(snapshot);
    expect(camera.quaternion.angleTo(expected)).toBeLessThan(1e-7);expect(camera.near).toBe(.007);expect(camera.far).toBe(900);expect(camera.fov).toBe(61);
    controller.dispose();
  });
  it('does not move for button Space or an already handled menu arrow', () => {
    nav.setMode('fly');
    const before = camera.position.clone();
    const button = new ElementStub(); button.tagName = 'BUTTON'; button.focus();
    expect(key('Space', button).defaultPrevented).toBe(false);
    nav.update(0.1);
    expect(camera.position.toArray()).toEqual(before.toArray());
    canvas.focus(); key('ArrowUp', canvas, true); nav.update(0.1);
    expect(camera.position.toArray()).toEqual(before.toArray());
  });
  it('allows canvas flight, stops held keys on focus loss, and requires a fresh press', () => {
    nav.setMode('fly'); key('KeyW'); nav.update(0.1);
    expect(camera.position.z).toBeLessThan(10);
    const before = camera.position.clone();
    new ElementStub().focus(); nav.update(0.1);
    expect(camera.position.toArray()).toEqual(before.toArray());
    canvas.focus(); key('KeyW', canvas, false, true); nav.update(0.1);
    expect(camera.position.toArray()).toEqual(before.toArray());
    key('KeyW'); nav.update(0.1);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0);
  });
  it('stops held movement when a modal opens even without a focus event', () => {
    nav.setMode('fly'); key('KeyW'); nav.update(0.1);
    const before = camera.position.clone(); modal = true; nav.update(0.1);
    expect(camera.position.toArray()).toEqual(before.toArray());
    modal = false; nav.update(0.1);
    expect(camera.position.toArray()).toEqual(before.toArray());
  });
  it('clears flight keys across a real mode transition', () => {
    nav.setMode('fly'); key('KeyW'); nav.setMode('orbit'); nav.setMode('fly');
    const before = camera.position.clone(); nav.update(0.1);
    expect(camera.position.toArray()).toEqual(before.toArray());
  });
  it('keeps the selected pivot when selecting active Orbit again', () => {
    const before = nav.snapshot(); nav.setMode('orbit');
    expect(nav.snapshot()).toEqual(before);
  });
});

function touch(type: string, id: number, x: number, y: number, time = 100): void {
  const event = new Event(type);
  Object.defineProperties(event, {
    pointerId: { value: id }, clientX: { value: x }, clientY: { value: y },
    pointerType: { value: 'touch' }, button: { value: 0 }, timeStamp: { value: time },
  });
  canvas.dispatchEvent(event);
}

function expectBoxInView(box: THREE.Box3): void {
  camera.updateMatrixWorld(true);
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        const point = new THREE.Vector3(x, y, z).project(camera);
        expect(Math.abs(point.x)).toBeLessThan(1);
        expect(Math.abs(point.y)).toBeLessThan(1);
        expect(Math.abs(point.z)).toBeLessThan(1);
      }
    }
  }
}

describe('scene framing', () => {
  it.each([0.46, 1, 2.16])('fits the complete box at aspect %s', (aspect) => {
    camera.aspect = aspect; camera.updateProjectionMatrix();
    const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    nav.frame(box); expectBoxInView(box);
  });
  it('fits a flat off-center ground pivot too', () => {
    camera.aspect = 0.46; camera.updateProjectionMatrix(); nav.up = 'z';
    const box = new THREE.Box3(new THREE.Vector3(-10, -8, 0), new THREE.Vector3(10, 8, 3));
    nav.frame(box, 0); expectBoxInView(box);
  });
  it('preserves a deliberate pose through resize, then resets to the new aspect fit', () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    nav.frame(box);
    const moved = nav.snapshot(); moved.position.add(new THREE.Vector3(1, 2, -1)); moved.pivot.x += 0.3;
    nav.restore(moved);
    camera.aspect = 0.46; camera.updateProjectionMatrix();
    expect(nav.snapshot()).toEqual(moved);
    nav.reset(false); expectBoxInView(box);
    expect(nav.pivot.toArray()).toEqual([0, 0, 0]);
  });
  it('finishes an intentional reset animation initiated by a focused button', () => {
    const box = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
    nav.frame(box); camera.position.multiplyScalar(2);
    const button = new ElementStub(); button.tagName = 'BUTTON'; button.focus();
    nav.reset(); nav.update(1);
    expectBoxInView(box);
    expect(nav.isMoving()).toBe(false);
  });
});

describe('touch continuity', () => {
  for (const event of ['pointerup', 'pointercancel']) {
    it.each([1, 2])(`continues Fly look when finger %s leaves through ${event}`, (leaving) => {
      nav.setMode('fly');
      touch('pointerdown', 1, 100, 100); touch('pointerdown', 2, 200, 100);
      touch(event, leaving, leaving === 1 ? 100 : 200, 100);
      const q = camera.quaternion.clone();
      const remaining = leaving === 1 ? 2 : 1;
      const startX = remaining === 1 ? 100 : 200;
      touch('pointermove', remaining, startX + 20, 100);
      expect(camera.quaternion.angleTo(q)).toBeGreaterThan(0.01);
    });
  }
  it.each([1, 2])('uses either moving finger %s for two-finger travel', (moving) => {
    nav.setMode('fly'); touch('pointerdown', 1, 100, 100); touch('pointerdown', 2, 200, 100);
    const before = camera.position.clone();
    touch('pointermove', moving, moving === 1 ? 100 : 200, 80);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0);
  });
  it('never treats canceled orbit touches as double taps', () => {
    for (const time of [100, 200]) {
      touch('pointerdown', 1, 100, 100, time);
      touch('pointercancel', 1, 100, 100, time + 10);
    }
    expect(nav.isMoving()).toBe(false);
  });
  it('can start another gesture after all touches cancel', () => {
    nav.setMode('fly'); touch('pointerdown', 1, 100, 100); touch('pointercancel', 1, 100, 100);
    touch('pointerdown', 2, 200, 100);
    const q = camera.quaternion.clone();
    touch('pointermove', 2, 240, 100); touch('pointermove', 2, 260, 100);
    expect(camera.quaternion.angleTo(q)).toBeGreaterThan(0.01);
  });
});
