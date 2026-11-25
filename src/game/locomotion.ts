import * as THREE from 'three';
import { insideFloor, type Footprint, type PlayerScale } from './frame';
import type { MeshCollision } from './meshCollision';
export type WalkWorld = {
  kind: 'virtual';
  footprint: Footprint;
} | {
  kind: 'mesh';
  collision: MeshCollision;
};
export interface WalkInput {
  forward: number;
  right: number;
  yaw: number;
  sprint: boolean;
}
export type WalkResult = {
  kind: 'ok';
} | {
  kind: 'recover';
  reason: string;
};
export class Walker {
  readonly foot: THREE.Vector3;
  readonly spawn: THREE.Vector3;
  readonly safe: THREE.Vector3;
  grounded = true;
  private velocity = 0;
  private accumulator = 0;
  constructor(readonly world: WalkWorld, readonly scale: PlayerScale, spawn: THREE.Vector3) {
    this.foot = spawn.clone();
    this.spawn = spawn.clone();
    this.safe = spawn.clone();
  }
  static spawn(world: WalkWorld, scale: PlayerScale, requested: THREE.Vector3): Walker | null {
    const foot = requested.clone();
    if (!foot.toArray().every(Number.isFinite))
      return null;
    if (world.kind === 'virtual') {
      foot.y = 0;
      return insideFloor(world.footprint, foot, scale.radius) ? new Walker(world, scale, foot) : null;
    }
    world.collision.beginFrame();
    const support = world.collision.support(foot.x, foot.z, foot.y + scale.step + scale.skin * 4, scale.step * 2 + scale.skin * 8);
    if (support.kind !== 'hit')
      return null;
    foot.y = support.y + scale.skin;
    const hit = world.collision.contacts(foot, scale);
    if (hit.kind !== 'ok' || hit.contacts.some(c => c.depth > scale.skin * 4))
      return null;
    return new Walker(world, scale, foot);
  }
  reset(): void { this.foot.copy(this.spawn); this.safe.copy(this.spawn); this.stop(); this.grounded = true; }
  stop(): void { this.velocity = 0; this.accumulator = 0; }
  update(elapsed: number, input: WalkInput): WalkResult {
    if (![elapsed, input.forward, input.right, input.yaw].every(Number.isFinite))
      return this.recover('Invalid player position.');
    if (this.world.kind === 'mesh') this.world.collision.beginFrame();
    this.accumulator += Math.min(Math.max(elapsed, 0), 0.05);
    while (this.accumulator >= 1 / 120) {
      this.accumulator -= 1 / 120;
      const result = this.step(1 / 120, input);
      if (result.kind !== 'ok')
        return result;
    }
    return { kind: 'ok' };
  }
  private step(dt: number, input: WalkInput): WalkResult {
    const direction = new THREE.Vector3(input.right, 0, -input.forward);
    if (direction.lengthSq() > 1)
      direction.normalize();
    direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), input.yaw);
    direction.multiplyScalar(this.scale.speed * (input.sprint ? 1.8 : 1) * dt);
    if (this.world.kind === 'virtual') {
      const f = this.world.footprint, r = this.scale.radius;
      this.foot.x = THREE.MathUtils.clamp(this.foot.x + direction.x, f.minX + r, f.maxX - r);
      this.foot.z = THREE.MathUtils.clamp(this.foot.z + direction.z, f.minZ + r, f.maxZ - r);
      this.foot.y = 0;
      this.safe.copy(this.foot);
      return { kind: 'ok' };
    }
    this.velocity = Math.max(this.velocity - this.scale.gravity * dt, -this.scale.eyeHeight * 10);
    direction.y = this.velocity * dt;
    const count = Math.max(1, Math.ceil(direction.length() / (this.scale.radius * 0.2)));
    if (count > 64)
      return this.recover('Movement exceeded the collision budget.');
    const delta = direction.multiplyScalar(1 / count);
    for (let part = 0; part < count; part++) {
      const before = this.foot.clone();
      this.foot.add(delta);
      const resolved = this.resolve();
      if (!resolved)
        return this.recover('Collision query exceeded its safety budget.');
      if (this.grounded && this.foot.clone().sub(before).setY(0).length() < delta.clone().setY(0).length() * 0.5) {
        this.tryStep(before, delta);
      }
    }
    if (this.foot.y < this.spawn.y - this.scale.eyeHeight * 5 || !this.foot.toArray().every(Number.isFinite)) {
      return this.recover('No safe floor below. Returned to the last safe position.');
    }
    if (this.grounded)
      this.safe.copy(this.foot);
    return { kind: 'ok' };
  }
  private resolve(): boolean {
    if (this.world.kind !== 'mesh')
      return true;
    this.grounded = false;
    for (let iteration = 0; iteration < 6; iteration++) {
      const hit = this.world.collision.contacts(this.foot, this.scale);
      if (hit.kind === 'budget')
        return false;
      if (hit.contacts.length === 0)
        break;
      const deepest = hit.contacts.reduce((a, b) => a.depth >= b.depth ? a : b);
      this.foot.addScaledVector(deepest.normal, deepest.depth + this.scale.skin);
      if (deepest.normal.y > Math.SQRT1_2) {
        this.grounded = true;
        this.velocity = Math.max(0, this.velocity);
      }
      if (deepest.normal.y < -0.1)
        this.velocity = Math.min(0, this.velocity);
    }
    const remain = this.world.collision.contacts(this.foot, this.scale);
    if (remain.kind === 'budget' || remain.contacts.some(c => c.depth > this.scale.skin * 4))
      return false;
    const support = this.world.collision.support(this.foot.x, this.foot.z, this.foot.y + this.scale.skin * 4, this.scale.skin * 10);
    if (support.kind === 'budget')
      return false;
    if (support.kind === 'hit' && this.velocity <= 0) {
      this.foot.y = support.y + this.scale.skin;
      this.grounded = true;
      this.velocity = 0;
    }
    return true;
  }
  private tryStep(before: THREE.Vector3, delta: THREE.Vector3): void {
    if (this.world.kind !== 'mesh')
      return;
    const candidate = before.clone().add(new THREE.Vector3(delta.x, this.scale.step, delta.z));
    // Check vertical clearance as well as landing; never teleport through a thin ceiling.
    const slices = Math.ceil(this.scale.step / (this.scale.radius * 0.2));
    for (let i = 1; i <= slices; i++) {
      const raised = before.clone().add(new THREE.Vector3(0, this.scale.step * i / slices, 0));
      const q = this.world.collision.contacts(raised, this.scale);
      if (q.kind !== 'ok' || q.contacts.some(c => c.depth > this.scale.skin * 4))
        return;
    }
    const q = this.world.collision.contacts(candidate, this.scale);
    if (q.kind !== 'ok' || q.contacts.length)
      return;
    const hit = this.world.collision.support(candidate.x, candidate.z, candidate.y, this.scale.step + this.scale.skin * 4);
    if (hit.kind !== 'hit' || hit.y < before.y - this.scale.skin * 4)
      return;
    candidate.y = hit.y + this.scale.skin;
    const landing = this.world.collision.contacts(candidate, this.scale);
    if (landing.kind === 'ok' && landing.contacts.every(c => c.depth <= this.scale.skin * 4)) {
      this.foot.copy(candidate);
      this.velocity = 0;
      this.grounded = true;
    }
  }
  private recover(reason: string): WalkResult {
    this.foot.copy(this.safe);
    this.stop();
    this.grounded = true;
    return { kind: 'recover', reason };
  }
}
