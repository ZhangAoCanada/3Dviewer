import * as THREE from 'three';
import { expect, it } from 'vitest';
import { entryLook, virtualEntryPoint } from '../src/game/entryView';
import { gameFrame, toLocal } from '../src/game/frame';
it('places virtual-floor spawn back from thin content and aims the initial view at it', () => {
  const bounds = new THREE.Box3(new THREE.Vector3(-2, -.02, -1), new THREE.Vector3(2, .02, 1));
  const prior = new THREE.Vector3(0, -.2, -1).normalize();
  const point = virtualEntryPoint(bounds, gameFrame(new THREE.Vector3(0, -.02, 0), new THREE.Vector3(0, 1, 0)), prior, .1);
  expect(Math.hypot(point.x, point.z)).toBeGreaterThan(.5);
  const frame = gameFrame(point, new THREE.Vector3(0, 1, 0));
  const look = entryLook(frame, bounds.getCenter(new THREE.Vector3()), .3, prior);
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(look.pitch, look.yaw, 0, 'YXZ'));
  const toContent = toLocal(frame, bounds.getCenter(new THREE.Vector3())).sub(new THREE.Vector3(0, .3, 0)).normalize();
  expect(forward.dot(toContent)).toBeGreaterThan(.999);
  expect(Math.abs(look.pitch)).toBeLessThan(Math.PI / 3);
});
it('avoids a vertical initial look when the mesh scene center is directly over spawn', () => {
  const look = entryLook(gameFrame(new THREE.Vector3(), new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, 3, 0), 1.7, new THREE.Vector3(1, -.5, -1));
  expect(look.yaw).toBeCloseTo(-Math.PI / 4);
  expect(look.pitch).toBeCloseTo(-Math.PI / 24);
});
it('keeps default artificial spawn inside a transformed finite floor', () => {
  const up = new THREE.Vector3(0, 0, 1), origin = new THREE.Vector3(100, 200, 300);
  const bounds = new THREE.Box3(new THREE.Vector3(98, 198, 300), new THREE.Vector3(102, 202, 300));
  const point = virtualEntryPoint(bounds, gameFrame(origin, up), new THREE.Vector3(1, 0, 0), .2);
  expect(point.z).toBeCloseTo(300);expect(point.x).toBeGreaterThanOrEqual(98.2);expect(point.x).toBeLessThanOrEqual(101.8);
});
