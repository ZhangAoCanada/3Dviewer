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
