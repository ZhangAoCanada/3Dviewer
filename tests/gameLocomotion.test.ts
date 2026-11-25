import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { gameFrame, playerScale, toLocal, toWorld } from '../src/game/frame';
import { MeshCollision, MAX_COLLISION_TRIANGLES } from '../src/game/meshCollision';
import { Walker, type WalkWorld } from '../src/game/locomotion';
const scale = playerScale(1.7);
if (!scale)
  throw new Error('Fixture scale');
const s = scale;
function quad(a: number[], b: number[], c: number[], d: number[]): THREE.Triangle[] {
  const v = (p: number[]) => new THREE.Vector3(p[0], p[1], p[2]);
  return [new THREE.Triangle(v(a), v(b), v(c)), new THREE.Triangle(v(a), v(c), v(d))];
}
function floor(y = 0, minX = -8, maxX = 8, minZ = -8, maxZ = 8) {
  return quad([minX, y, minZ], [minX, y, maxZ], [maxX, y, maxZ], [maxX, y, minZ]);
}
function room(extra: THREE.Triangle[] = []): WalkWorld {
  return { kind: 'mesh', collision: new MeshCollision([...floor(), ...extra]) };
}
const idle = { forward: 0, right: 0, yaw: 0, sprint: false };
function run(w: Walker, count: number, input = idle) {
  for (let i = 0; i < count; i++)
    w.update(1 / 60, input);
}
function spawn(world: WalkWorld, foot = new THREE.Vector3()) {
  const walker = Walker.spawn(world, s, foot);
  if (!walker)
    throw new Error('Invalid fixture spawn');
  return walker;
}
describe('game frame and calibration', () => {
  it('round trips arbitrary tilted up without touching content', () => {
    const frame = gameFrame(new THREE.Vector3(4e6, -3e6, 2e6), new THREE.Vector3(0.2, 0.1, 1));
    const point = new THREE.Vector3(1, 2, 3);
    expect(toLocal(frame, toWorld(frame, point)).distanceTo(point)).toBeLessThan(1e-8);
    expect(new THREE.Vector3(0, 1, 0).applyQuaternion(frame.rotation).angleTo(new THREE.Vector3(.2, .1, 1))).toBeLessThan(1e-7);
  });
  it.each([0, -1, NaN, Infinity, 1e-8])('rejects bad scene eye height %s', n => expect(playerScale(n)).toBeNull());
  it('scales body, speed and gravity coherently', () => {
    const large = playerScale(1700);
    expect(large?.radius).toBeCloseTo(s.radius * 1000);
    expect(large?.gravity).toBeCloseTo(s.gravity * 1000);
  });
});
describe('grounded virtual floor', () => {
  const world: WalkWorld = { kind: 'virtual', footprint: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 } };
  it('moves relative to yaw, normalizes diagonals, never flies and blocks boundaries', () => {
    const a = spawn(world), b = spawn(world);
    run(a, 60, { ...idle, forward: 1 });
    run(b, 60, { ...idle, forward: 1, right: 1 });
    expect(a.foot.length()).toBeCloseTo(b.foot.length());
    const turned = spawn(world);
    run(turned, 60, { ...idle, forward: 1, yaw: Math.PI / 2 });
    expect(turned.foot.x).toBeLessThan(-2);
    expect(turned.foot.y).toBe(0);
    run(turned, 1000, { ...idle, right: 1, sprint: true });
    expect(turned.foot.x).toBeLessThanOrEqual(10 - s.radius);
    expect(Walker.spawn(world, s, new THREE.Vector3(10, 0, 0))).toBeNull();
  });
  it('does not catch up hidden-tab time and recovers invalid inputs safely', () => {
    const w = spawn(world);
    w.update(1000, { ...idle, forward: 1 });
    expect(w.foot.length()).toBeLessThan(s.speed * .06);
    expect(w.update(.01, { ...idle, yaw: NaN }).kind).toBe('recover');
    expect(w.foot.toArray().every(Number.isFinite)).toBe(true);
  });
});
describe('static mesh collision', () => {
  it('rests on the floor independent of triangle winding', () => {
    const triangles = floor().map(t => new THREE.Triangle(t.c, t.b, t.a));
    const w = spawn({ kind: 'mesh', collision: new MeshCollision(triangles) });
    run(w, 600);
    expect(w.foot.y).toBeCloseTo(0, 2);
    expect(w.grounded).toBe(true);
  });
  it('stops at thin walls at sprint and slides along them', () => {
    const wall = quad([-8, 0, -2], [8, 0, -2], [8, 4, -2], [-8, 4, -2]);
    const w = spawn(room(wall));
    run(w, 180, { ...idle, forward: 1, right: .4, sprint: true });
    expect(w.foot.z).toBeGreaterThan(-2 + s.radius - .01);
    expect(w.foot.x).toBeGreaterThan(3);
  });
  it('rejects spawn inside walls and under low ceilings', () => {
    expect(Walker.spawn(room(floor(1)), s, new THREE.Vector3())).toBeNull();
    const wall = quad([0, 0, -3], [0, 4, -3], [0, 4, 3], [0, 0, 3]);
    expect(Walker.spawn(room(wall), s, new THREE.Vector3())).toBeNull();
  });
  it('does not invent a support plane over holes and recovers after a fall', () => {
    const world: WalkWorld = { kind: 'mesh', collision: new MeshCollision(floor(0, -3, 3, -1, 3)) };
    const w = spawn(world);
    let recovered = false;
    for (let i = 0; i < 240; i++)
      if (w.update(1 / 60, { ...idle, forward: 1 }).kind === 'recover') {
        recovered = true;
        break;
      }
    expect(recovered).toBe(true);
    expect(w.foot.y).toBeGreaterThan(-.01);
  });
  it('follows a lower floor without snapping to an overhead level', () => {
    const world = { kind: 'mesh', collision: new MeshCollision([...floor(0, -4, 4, -1, 4), ...floor(-1, -4, 4, -8, -1), ...floor(3)]) } satisfies WalkWorld;
    const w = spawn(world);
    run(w, 100, { ...idle, forward: 1 });
    expect(w.foot.y).toBeCloseTo(-1, 2);
    expect(w.grounded).toBe(true);
  });
  it('climbs small steps but rejects tall ones', () => {
    const step = (h: number) => [...floor(h, -4, 4, -8, -1), ...quad([-4, 0, -1], [4, 0, -1], [4, h, -1], [-4, h, -1])];
    const low = spawn(room(step(.18)));
    run(low, 100, { ...idle, forward: 1 });
    expect(low.foot.y).toBeCloseTo(.18, 2);
    expect(low.foot.z).toBeLessThan(-2);
    const tall = spawn(room(step(.7)));
    run(tall, 100, { ...idle, forward: 1 });
    expect(tall.foot.z).toBeGreaterThan(-1 + s.radius - .02);
    expect(tall.foot.y).toBeLessThan(.02);
  });
  it('blocks stepping through a low overhang', () => {
    const step = [...floor(.2, -4, 4, -8, -1), ...quad([-4, 0, -1], [4, 0, -1], [4, .2, -1], [-4, .2, -1]), ...floor(s.height + .05)];
    const w = spawn(room(step));
    run(w, 120, { ...idle, forward: 1 });
    expect(w.foot.z).toBeGreaterThan(-1 + s.radius - .04);
  });
  it('follows walkable ramps', () => {
    const ramp = quad([-4, 0, -1], [4, 0, -1], [4, 1, -4], [-4, 1, -4]);
    const w = spawn(room(ramp));
    run(w, 75, { ...idle, forward: 1 });
    expect(w.foot.y).toBeGreaterThan(.3);
    expect(w.grounded).toBe(true);
  });
  it('does not climb a steep slope just by walking into it', () => {
    const ramp = quad([-4, 0, -1], [4, 0, -1], [4, 4, -2], [-4, 4, -2]);
    const w = spawn(room(ramp));
    run(w, 180, { ...idle, forward: 1, sprint: true });
    expect(w.foot.y).toBeLessThan(.12);
    expect(w.foot.z).toBeGreaterThan(-1.1);
  });
  it('stops at a two-wall corner without penetration', () => {
    const walls = [...quad([-8, 0, -2], [8, 0, -2], [8, 4, -2], [-8, 4, -2]), ...quad([2, 0, -8], [2, 0, 8], [2, 4, 8], [2, 4, -8])];
    const w = spawn(room(walls));
    run(w, 180, { ...idle, forward: 1, right: 1, sprint: true });
    expect(w.foot.z).toBeGreaterThan(-2 + s.radius - .01);
    expect(w.foot.x).toBeLessThan(2 - s.radius + .01);
  });
  it('query budget exhaustion is not a collision-free result', () => {
    const repeated = Array.from({ length: 5000 }, () => floor()[0]).filter((t): t is THREE.Triangle => t !== undefined);
    const collision = new MeshCollision(repeated);
    expect(collision.contacts(new THREE.Vector3(), s).kind).toBe('budget');
    expect(Walker.spawn({ kind: 'mesh', collision }, s, new THREE.Vector3())).toBeNull();
  });
  it('rejects resource overflow rather than dropping triangles', () => {
    expect(() => new MeshCollision(Array.from({ length: MAX_COLLISION_TRIANGLES + 1 }, () => floor()[0]).filter((t): t is THREE.Triangle => t !== undefined))).toThrow('budget');
  });
  it('reset returns to validated spawn', () => { const w = spawn(room()); run(w, 40, { ...idle, right: 1 }); w.reset(); expect(w.foot.toArray()).toEqual(w.spawn.toArray()); });
});
