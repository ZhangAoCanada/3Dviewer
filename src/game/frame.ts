import * as THREE from 'three';
export interface GameFrame {
  origin: THREE.Vector3;
  rotation: THREE.Quaternion;
  inverse: THREE.Quaternion;
}
/** The scene stays untouched. Physics has a nearby origin and Y follows chosen floor up. */
export function gameFrame(origin: THREE.Vector3, normal: THREE.Vector3): GameFrame {
  if (![...origin.toArray(), ...normal.toArray()].every(Number.isFinite) || normal.lengthSq() < 1e-16) {
    throw new Error('Choose a finite floor with a nonzero normal.');
  }
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone().normalize());
  return { origin: origin.clone(), rotation, inverse: rotation.clone().invert() };
}
export function toLocal(frame: GameFrame, world: THREE.Vector3): THREE.Vector3 {
  return world.clone().sub(frame.origin).applyQuaternion(frame.inverse);
}
export function toWorld(frame: GameFrame, local: THREE.Vector3): THREE.Vector3 {
  return local.clone().applyQuaternion(frame.rotation).add(frame.origin);
}
export interface PlayerScale {
  eyeHeight: number;
  height: number;
  radius: number;
  speed: number;
  gravity: number;
  step: number;
  skin: number;
}
/** No assumed metres: every dimension follows the explicitly adjustable scene-unit eye height. */
export function playerScale(eyeHeight: number): PlayerScale | null {
  if (!Number.isFinite(eyeHeight) || eyeHeight < 1e-5 || eyeHeight > 1e8)
    return null;
  return { eyeHeight, height: eyeHeight * 1.08, radius: eyeHeight * 0.17,
    speed: eyeHeight * 1.7, gravity: eyeHeight * 5.8, step: eyeHeight * 0.16, skin: eyeHeight * 0.0005 };
}
export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
export function insideFloor(footprint: Footprint, foot: THREE.Vector3, radius: number): boolean {
  return foot.x >= footprint.minX + radius && foot.x <= footprint.maxX - radius &&
    foot.z >= footprint.minZ + radius && foot.z <= footprint.maxZ - radius;
}
