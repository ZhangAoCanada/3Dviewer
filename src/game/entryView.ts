import * as THREE from 'three';
import { toLocal, toWorld, type GameFrame } from './frame';
import { footprintInFrame } from './sceneGeometry';
/** Artificial-floor spawn only: stand back from the content instead of inside a thin cloud. */
export function virtualEntryPoint(bounds: THREE.Box3, frame: GameFrame, forward: THREE.Vector3, radius: number): THREE.Vector3 {
  const f = footprintInFrame(bounds, frame), width = f.maxX - f.minX, depth = f.maxZ - f.minZ;
  if (width <= radius * 2 || depth <= radius * 2) return frame.origin.clone();
  const direction = forward.clone().applyQuaternion(frame.inverse).setY(0);
  if (direction.lengthSq() < 1e-12) direction.set(0, 0, -1);
  direction.normalize();
  const distance = Math.max(width, depth) * .25;
  return toWorld(frame, new THREE.Vector3(
    THREE.MathUtils.clamp((f.minX + f.maxX) / 2 - direction.x * distance, f.minX + radius, f.maxX - radius), 0,
    THREE.MathUtils.clamp((f.minZ + f.maxZ) / 2 - direction.z * distance, f.minZ + radius, f.maxZ - radius)));
}
/** Deterministic initial heading. Virtual-floor views aim at the content; mesh spawn avoids a vertical look. */
export function entryLook(frame: GameFrame, target: THREE.Vector3, eyeHeight: number, priorForward: THREE.Vector3): { yaw: number; pitch: number } {
  const toward = toLocal(frame, target).sub(new THREE.Vector3(0, eyeHeight, 0));
  const horizontal = Math.hypot(toward.x, toward.z);
  if (horizontal > eyeHeight * .5) return { yaw: Math.atan2(-toward.x, -toward.z), pitch: THREE.MathUtils.clamp(Math.atan2(toward.y, horizontal), -Math.PI / 3, Math.PI / 3) };
  const forward = priorForward.clone().applyQuaternion(frame.inverse);
  return { yaw: Math.hypot(forward.x, forward.z) > 1e-8 ? Math.atan2(-forward.x, -forward.z) : 0, pitch: -Math.PI / 24 };
}
