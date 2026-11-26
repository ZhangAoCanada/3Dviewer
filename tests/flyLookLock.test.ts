import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { NavigationController } from '../src/render/Navigation';

class ElementStub extends EventTarget {
  tagName = 'CANVAS';
  id = '';
  isContentEditable = false;
  clientHeight = 800;
  clientWidth = 1200;
  focus(): void { focusElement(this); }
  setPointerCapture(): void {}
  requestPointerLock(): Promise<void> {
    requests.push('lock');
    lockElement(this);
    return Promise.resolve();
  }
}
let active: ElementStub;
let doc: EventTarget;
let win: EventTarget;
let modal = false;
let nav: NavigationController;
let camera: THREE.PerspectiveCamera;
let canvas: ElementStub;
let lock: ElementStub | null;
let requests: string[];
let notices: string[];

function focusElement(element: ElementStub): void {
  active = element;
  doc.dispatchEvent(new Event('focusin'));
}

function lockElement(element: ElementStub): void {
  lock = element;
  doc.dispatchEvent(new Event('pointerlockchange'));
}

function key(code: string, target = active): Event {
  const event = new Event('keydown', { cancelable: true });
  Object.defineProperties(event, { code: { value: code }, target: { value: target } });
  win.dispatchEvent(event);
  return event;
}

function mouseMove(movementX: number, movementY: number): void {
  const event = new Event('mousemove');
  Object.defineProperties(event, { movementX: { value: movementX }, movementY: { value: movementY } });
  doc.dispatchEvent(event);
}

function pointer(type: string, x: number, y: number, pointerType = 'mouse', button = 0, id = 1): void {
  const event = new Event(type);
  Object.defineProperties(event, {
    pointerId: { value: id }, clientX: { value: x }, clientY: { value: y },
    pointerType: { value: pointerType }, button: { value: button },
  });
  canvas.dispatchEvent(event);
}

beforeEach(() => {
  win = new EventTarget();
  doc = new EventTarget();
  canvas = new ElementStub();
  active = canvas;
  modal = false;
  lock = null;
  requests = [];
  notices = [];
  Object.defineProperties(doc, {
    activeElement: { get: () => active },
    body: { value: new ElementStub() },
    pointerLockElement: { get: () => lock },
    querySelector: { value: () => modal ? new ElementStub() : null },
    exitPointerLock: { value: () => { lock = null; doc.dispatchEvent(new Event('pointerlockchange')); } },
  });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  vi.stubGlobal('HTMLElement', ElementStub);
  camera = new THREE.PerspectiveCamera(55, 1, 0.01, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  nav = new NavigationController(camera, canvas as unknown as HTMLElement);
  nav.onLookLock = (reason) => { notices.push(reason); };
});
afterEach(() => { nav.dispose(); vi.unstubAllGlobals(); });

describe('fly default mouse look', () => {
  it('requests pointer lock synchronously from a Fly gesture, without a second canvas click', () => {
    const position = camera.position.clone();
    const quaternion = camera.quaternion.clone();
    nav.setMode('fly');
    expect(requests).toEqual([]);
    expect(camera.position.toArray()).toEqual(position.toArray());
    expect(camera.quaternion.toArray()).toEqual(quaternion.toArray());
    expect(nav.requestLookLock()).toBe('requested');
    expect(requests).toEqual(['lock']);
    expect(nav.isLookLocked()).toBe(true);
    expect(notices).toEqual(['acquired']);
    expect(nav.requestLookLock()).toBe('held');
    expect(requests).toEqual(['lock']);
  });

  it('does not request lock from setMode alone, so keyboard Fly entry stays legal', () => {
    nav.setMode('fly');
    expect(requests).toEqual([]);
    expect(nav.isLookLocked()).toBe(false);
    canvas.requestPointerLock = () => { requests.push('denied'); return Promise.reject(new DOMException('denied', 'NotAllowedError')); };
    const before = camera.quaternion.clone();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 140, 100);
    expect(requests).toEqual(['denied']);
    expect(nav.isLookLocked()).toBe(false);
    expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.01);
  });

  it('looks from relative mouse movement once locked, without a drag', () => {
    nav.setMode('fly');
    nav.requestLookLock();
    const before = camera.quaternion.clone();
    mouseMove(40, 0);
    expect(camera.quaternion.toArray()).toEqual(before.toArray());
    mouseMove(40, 0);
    expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.01);
    expect(nav.isMoving()).toBe(false);
  });

  it('ignores the first nonzero locked move, including a large toolbar-handoff impulse, then applies later moves 1:1', () => {
    nav.setMode('fly');
    nav.requestLookLock();
    const start = camera.quaternion.clone();
    for (let i = 0; i < 20; i += 1) mouseMove(0, 0);
    expect(camera.quaternion.toArray()).toEqual(start.toArray());
    mouseMove(-960, 40);
    expect(camera.quaternion.toArray()).toEqual(start.toArray());
    mouseMove(20, 0);
    const once = camera.quaternion.angleTo(start);
    expect(once).toBeGreaterThan(0.01);
    const mid = camera.quaternion.clone();
    mouseMove(20, 0);
    expect(camera.quaternion.angleTo(mid)).toBeCloseTo(once, 6);
    // A later super-threshold event is a discontinuity, not a second handoff, and does not rotate.
    const afterOrdinary = camera.quaternion.clone();
    mouseMove(-960, 0);
    expect(camera.quaternion.toArray()).toEqual(afterOrdinary.toArray());
    mouseMove(20, 0);
    expect(camera.quaternion.angleTo(afterOrdinary)).toBeCloseTo(once, 6);
  });

  it('rearms the capture-handoff guard on recapture so resume cannot warp the view', () => {
    nav.setMode('fly');
    nav.requestLookLock();
    mouseMove(-960, 0);
    mouseMove(24, 0);
    const aimed = camera.quaternion.clone();
    document.exitPointerLock();
    expect(nav.requestLookLock()).toBe('requested');
    expect(nav.isLookLocked()).toBe(true);
    mouseMove(-960, 80);
    expect(camera.quaternion.toArray()).toEqual(aimed.toArray());
    mouseMove(24, 0);
    expect(camera.quaternion.angleTo(aimed)).toBeGreaterThan(0.01);
  });

  it('treats a movement that arrives before pointerlockchange as the handoff and does not re-arm when the change follows', () => {
    canvas.requestPointerLock = () => {
      requests.push('pending');
      lock = canvas;
      return Promise.resolve();
    };
    nav.setMode('fly');
    expect(nav.requestLookLock()).toBe('requested');
    expect(nav.isLookLocked()).toBe(false);
    expect(lock).toBe(canvas);
    const start = camera.quaternion.clone();
    mouseMove(-960, 40);
    expect(nav.isLookLocked()).toBe(true);
    expect(notices).toEqual(['acquired']);
    expect(camera.quaternion.toArray()).toEqual(start.toArray());
    // A late pointerlockchange must not reset the guard after the handoff was already consumed.
    doc.dispatchEvent(new Event('pointerlockchange'));
    mouseMove(20, 0);
    expect(camera.quaternion.angleTo(start)).toBeGreaterThan(0.01);
  });

  it('keeps the explored pose when leaving lock, and drag-look still works afterwards', () => {
    nav.setMode('fly');
    nav.requestLookLock();
    mouseMove(30, -10);
    mouseMove(30, -10);
    const held = camera.quaternion.clone();
    document.exitPointerLock();
    expect(nav.isLookLocked()).toBe(false);
    expect(notices.at(-1)).toBe('released');
    expect(camera.quaternion.toArray()).toEqual(held.toArray());
    canvas.requestPointerLock = () => { requests.push('denied'); return Promise.reject(new DOMException('denied', 'NotAllowedError')); };
    const before = camera.quaternion.clone();
    pointer('pointerdown', 220, 220);
    pointer('pointermove', 260, 220);
    expect(nav.isLookLocked()).toBe(false);
    expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.01);
  });

  it('notifies denial and leaves drag-look as the fallback', async () => {
    nav.setMode('fly');
    canvas.requestPointerLock = () => { requests.push('denied'); return Promise.reject(new DOMException('denied', 'NotAllowedError')); };
    expect(nav.requestLookLock()).toBe('requested');
    await Promise.resolve();
    expect(nav.isLookLocked()).toBe(false);
    expect(notices).toContain('denied');
    const before = camera.quaternion.clone();
    pointer('pointerdown', 40, 40);
    pointer('pointermove', 90, 40);
    expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.01);
  });

  it('does not request lock in Orbit, and leaving Fly releases a held lock', () => {
    expect(nav.requestLookLock()).toBe('unavailable');
    expect(requests).toEqual([]);
    nav.setMode('fly');
    nav.requestLookLock();
    expect(nav.isLookLocked()).toBe(true);
    nav.setMode('orbit');
    expect(nav.isLookLocked()).toBe(false);
    expect(lock).toBeNull();
  });

  it('releases look lock on Escape and keeps the current Fly pose', () => {
    nav.setMode('fly');
    nav.requestLookLock();
    mouseMove(20, 8);
    mouseMove(20, 8);
    const held = camera.quaternion.clone();
    const event = new Event('keydown', { cancelable: true });
    Object.defineProperties(event, { code: { value: 'Escape' }, target: { value: canvas } });
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(nav.isLookLocked()).toBe(false);
    expect(notices.at(-1)).toBe('released');
    expect(camera.quaternion.toArray()).toEqual(held.toArray());
    expect(nav.mode).toBe('fly');
  });

  it('does not let the same Escape close upright or a phone sheet after releasing look', () => {
    nav.setMode('fly');
    nav.requestLookLock();
    let closedChrome = false;
    win.addEventListener('keydown', (event) => {
      // Same contract as ViewerApp.onEscape: do not dismiss upright/sheet after Fly consumes Escape.
      if (event.defaultPrevented) return;
      closedChrome = true;
    });
    const event = new Event('keydown', { cancelable: true, bubbles: true });
    Object.defineProperties(event, { code: { value: 'Escape' }, target: { value: canvas } });
    win.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(closedChrome).toBe(false);
    expect(nav.isLookLocked()).toBe(false);
    expect(nav.mode).toBe('fly');
  });

  it('still moves with WASD and Space when the Fly button retains focus under lock', () => {
    nav.setMode('fly');
    nav.requestLookLock();
    mouseMove(-960, 0);
    const fly = new ElementStub();
    fly.tagName = 'BUTTON';
    fly.id = 'mode-fly';
    focusElement(fly);
    expect(nav.isLookLocked()).toBe(true);
    const before = camera.position.clone();
    key('KeyW', fly);
    nav.update(0.1);
    expect(camera.position.distanceTo(before)).toBeGreaterThan(0);
    const mid = camera.position.clone();
    key('Space', fly);
    nav.update(0.1);
    expect(camera.position.y).toBeGreaterThan(mid.y);
  });

  it('exits a late-arriving lock after switching to Orbit or opening a dialog during pending capture', () => {
    let grant: (() => void) | undefined;
    canvas.requestPointerLock = () => {
      requests.push('pending');
      return new Promise<void>((resolve) => {
        grant = () => { lockElement(canvas); resolve(); };
      });
    };
    nav.setMode('fly');
    expect(nav.requestLookLock()).toBe('requested');
    expect(nav.requestLookLock()).toBe('requested');
    expect(requests).toEqual(['pending']);
    expect(lock).toBeNull();
    nav.setMode('orbit');
    grant?.();
    expect(nav.mode).toBe('orbit');
    expect(nav.isLookLocked()).toBe(false);
    expect(lock).toBeNull();

    requests.length = 0;
    nav.setMode('fly');
    expect(nav.requestLookLock()).toBe('requested');
    const field = new ElementStub();
    field.tagName = 'INPUT';
    focusElement(field);
    grant?.();
    expect(nav.isLookLocked()).toBe(false);
    expect(lock).toBeNull();
  });

  it('drops Fly lock ownership when Game suspends navigation', () => {
    nav.setMode('fly');
    nav.requestLookLock();
    expect(nav.isLookLocked()).toBe(true);
    nav.setSuspended(true);
    expect(nav.isLookLocked()).toBe(false);
    expect(lock).toBeNull();
  });

  it('releases lock when focus moves to an editable or a dialog', () => {
    nav.setMode('fly');
    nav.requestLookLock();
    const field = new ElementStub();
    field.tagName = 'INPUT';
    field.isContentEditable = false;
    focusElement(field);
    expect(nav.isLookLocked()).toBe(false);
    nav.requestLookLock();
    expect(nav.isLookLocked()).toBe(false);
    focusElement(canvas);
    nav.requestLookLock();
    expect(nav.isLookLocked()).toBe(true);
    modal = true;
    const button = new ElementStub();
    button.tagName = 'BUTTON';
    focusElement(button);
    expect(nav.isLookLocked()).toBe(false);
  });

  it('does not treat touch look as a pointer-lock request', () => {
    nav.setMode('fly');
    const before = camera.quaternion.clone();
    pointer('pointerdown', 100, 100, 'touch');
    pointer('pointermove', 150, 100, 'touch');
    expect(requests).toEqual([]);
    expect(nav.isLookLocked()).toBe(false);
    expect(camera.quaternion.angleTo(before)).toBeGreaterThan(0.01);
  });

  it('ignores locked pointer-drag so look is not applied twice', () => {
    nav.setMode('fly');
    nav.requestLookLock();
    const afterLock = camera.quaternion.clone();
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 180, 40);
    expect(camera.quaternion.toArray()).toEqual(afterLock.toArray());
    mouseMove(-960, 0);
    expect(camera.quaternion.toArray()).toEqual(afterLock.toArray());
    mouseMove(24, 0);
    expect(camera.quaternion.angleTo(afterLock)).toBeGreaterThan(0.01);
  });
});
