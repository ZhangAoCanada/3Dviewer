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
  private standing: PlayerScale;
  private body: PlayerScale;
  private readonly walkSpeed: number;
  crouched = false;
  private speedMultiplier = 1;
  get speedScale(): number { return this.speedMultiplier; }
  private withinStepBudget(scale: PlayerScale, speed: number, standingEye = scale.eyeHeight): boolean {
    return this.world.kind === 'virtual' || Math.ceil(Math.hypot(this.walkSpeed * speed * 1.8, standingEye * 10) / 120 / (scale.radius * .2)) <= 64;
  }
  setSpeed(value: number): boolean {
    if (!Number.isFinite(value) || value < .25 || value > 4 || !this.withinStepBudget(this.body, value, this.standing.eyeHeight)) return false;
    this.speedMultiplier = value;return true;
  }
  private eye = 0;
  get baseSpeed(): number { return this.walkSpeed; }
  get scale(): PlayerScale { return this.body; }
  get standingScale(): Readonly<PlayerScale> { return this.standing; }
  get cameraEyeHeight(): number { return this.eye; }
  private fits(foot: THREE.Vector3, scale: PlayerScale): boolean {
    if (this.world.kind === 'virtual') return insideFloor(this.world.footprint, foot, scale.radius);
    const hit = this.world.collision.contacts(foot, scale);
    return hit.kind === 'ok' && hit.contacts.every(c => c.depth <= scale.skin * 4);
  }
  private stance(scale: PlayerScale, crouched: boolean): PlayerScale {
    return crouched ? { ...scale, eyeHeight: scale.eyeHeight * .62, height: scale.height * .62, step: scale.step * .62 } : { ...scale };
  }
  resize(scale: PlayerScale): boolean {
    if (this.world.kind === 'mesh') this.world.collision.beginFrame();
    const next = this.stance(scale, this.crouched);
    if (!this.withinStepBudget(next, this.speedMultiplier, scale.eyeHeight) || !this.fits(this.foot, next) || !this.fits(this.spawn, next)) return false;
    this.standing = { ...scale }; this.body = next;
    this.eye = next.eyeHeight;
    this.safe.copy(this.foot);
    return true;
  }
  setCrouched(crouched: boolean): boolean {
    if (crouched === this.crouched) return true;
    if (this.world.kind === 'mesh') this.world.collision.beginFrame();
    const next = this.stance(this.standing, crouched);
    if (!this.fits(this.foot, next)) return false;
    this.crouched = crouched; this.body = next;
    // Shrink immediately: the camera must never remain above the new collision body.
    this.eye = Math.min(this.eye, next.eyeHeight);
    return true;
  }
  jump(): boolean {
    if (!this.grounded) return false;
    if (this.world.kind === 'mesh') {
      this.world.collision.beginFrame();
      if (!this.fits(this.foot.clone().add(new THREE.Vector3(0, this.standing.eyeHeight * .02, 0)), this.body)) return false;
    }
    this.velocity = Math.sqrt(2 * this.standing.gravity * this.standing.eyeHeight * .35);
    this.grounded = false;
    return true;
  }
  advanceEye(elapsed: number, reducedMotion: boolean): void {
    const change = this.standing.eyeHeight * .38 * Math.max(0, elapsed) / .12;
    this.eye = reducedMotion ? this.body.eyeHeight : this.eye + THREE.MathUtils.clamp(this.body.eyeHeight - this.eye, -change, change);
    if (Math.abs(this.eye - this.body.eyeHeight) < this.standing.eyeHeight * 1e-6) this.eye = this.body.eyeHeight;
  }
  private accumulator = 0;
  lastStepTime=0;
  constructor(readonly world: WalkWorld, scale: PlayerScale, spawn: THREE.Vector3, walkSpeed = scale.speed) {
    this.standing = { ...scale }; this.body = { ...scale }; this.walkSpeed = walkSpeed; this.eye = scale.eyeHeight;
    this.foot = spawn.clone();
    this.spawn = spawn.clone();
    this.safe = spawn.clone();
  }
  /** Transactional copy, including airborne momentum and temporary stance. */
  fork(scale:PlayerScale,walkSpeed=this.walkSpeed):Walker|null {
    const copy=new Walker(this.world,this.standing,this.spawn,walkSpeed);
    copy.foot.copy(this.foot);copy.safe.copy(this.safe);copy.velocity=this.velocity;
    copy.grounded=this.grounded;copy.crouched=this.crouched;copy.body={...this.body};copy.eye=this.eye;copy.speedMultiplier=this.speedMultiplier;
    if(scale.eyeHeight!==this.standing.eyeHeight&&!copy.resize(scale))return null;
    return copy.setSpeed(this.speedMultiplier)?copy:null;
  }
  static spawn(world: WalkWorld, scale: PlayerScale, requested: THREE.Vector3, walkSpeed = scale.speed, crouched=false): Walker | null {
    const standing=scale;
    if(crouched)scale={...scale,eyeHeight:scale.eyeHeight*.62,height:scale.height*.62,step:scale.step*.62};
    const create=(foot:THREE.Vector3)=>{const walker=new Walker(world,standing,foot,walkSpeed);if(crouched&&!walker.setCrouched(true))return null;return walker;};
    const foot = requested.clone();
    if (!foot.toArray().every(Number.isFinite))
      return null;
    if (world.kind === 'virtual') {
      foot.y = 0;
      return insideFloor(world.footprint, foot, scale.radius) ? create(foot) : null;
    }
    world.collision.beginFrame();
    const support = world.collision.support(foot.x, foot.z, foot.y + scale.step + scale.skin * 4, scale.step * 2 + scale.skin * 8);
    if (support.kind !== 'hit')
      return null;
    foot.y = support.y + scale.skin;
    const hit = world.collision.contacts(foot, scale);
    if (hit.kind !== 'ok' || hit.contacts.some(c => c.depth > scale.skin * 4))
      return null;
    return create(foot);
  }
  reset(): void { this.foot.copy(this.spawn); this.safe.copy(this.spawn); this.velocity = 0; this.stop(); this.grounded = true; this.setCrouched(false); this.eye = this.body.eyeHeight; }
  stop(): void { this.accumulator = 0; }
  update(elapsed: number, input: WalkInput): WalkResult {
    this.lastStepTime=0;
    if (![elapsed, input.forward, input.right, input.yaw].every(Number.isFinite))
      return this.recover('Invalid player position.');
    if (this.world.kind === 'mesh') this.world.collision.beginFrame();
    this.accumulator += Math.min(Math.max(elapsed, 0), 0.05);
    while (this.accumulator >= 1 / 120) {
      this.accumulator -= 1 / 120;this.lastStepTime+=1/120;
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
    direction.multiplyScalar(this.walkSpeed * this.speedScale * (this.crouched ? .55 : input.sprint ? 1.8 : 1) * dt);
    if (this.world.kind === 'virtual') {
      const f = this.world.footprint, r = this.scale.radius;
      this.foot.x = THREE.MathUtils.clamp(this.foot.x + direction.x, f.minX + r, f.maxX - r);
      this.foot.z = THREE.MathUtils.clamp(this.foot.z + direction.z, f.minZ + r, f.maxZ - r);
      this.velocity = Math.max(this.velocity - this.standing.gravity * dt, -this.standing.eyeHeight * 10);
      this.foot.y = Math.max(0, this.foot.y + this.velocity * dt);
      if (this.foot.y === 0) { this.velocity = 0; this.grounded = true; this.safe.copy(this.foot); }
      return { kind: 'ok' };
    }
    const wasGrounded = this.grounded;
    this.velocity = Math.max(this.velocity - this.scale.gravity * dt, -this.standing.eyeHeight * 10);
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
        return this.recover('Movement could not be resolved safely. Returned to the last safe position.');
      if (wasGrounded && this.grounded && this.velocity <= 0 && this.foot.clone().sub(before).setY(0).length() < delta.clone().setY(0).length() * 0.5) {
        this.tryStep(before, delta);
      }
    }
    if (this.foot.y < this.spawn.y - this.standing.eyeHeight * 5 || !this.foot.toArray().every(Number.isFinite)) {
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
    this.velocity = 0;
    this.stop();
    this.grounded = true;
    return { kind: 'recover', reason };
  }
}
