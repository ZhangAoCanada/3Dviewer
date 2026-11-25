import * as THREE from 'three';
import { gameFrame, toLocal, toWorld, type GameFrame, type Footprint } from './frame';
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

/** Explicit artificial walking area, including stand-back room around thin/vertical content. */
export function virtualFootprint(bounds: THREE.Box3, frame: GameFrame, eyeHeight: number): Footprint {
  const f = footprintInFrame(bounds, frame);
  const margin = Math.max(eyeHeight * 3, (Math.max(f.maxX - f.minX, f.maxZ - f.minZ)) * .15);
  return { minX: Math.min(f.minX - margin, -margin), maxX: Math.max(f.maxX + margin, margin), minZ: Math.min(f.minZ - margin, -margin), maxZ: Math.max(f.maxZ + margin, margin) };
}
/** Scene units, not estimated metres. Keep thin facade bodies bounded relative to content. */
export function defaultEyeHeight(bounds: THREE.Box3, up: THREE.Vector3): number {
  const f = footprintInFrame(bounds, gameFrame(bounds.getCenter(new THREE.Vector3()), up));
  const size = bounds.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, .001);
  const horizontal = Math.max(f.maxX - f.minX, f.maxZ - f.minZ, span * .01);
  return THREE.MathUtils.clamp(Math.max(horizontal, span) * .08, .00001, 1e8);
}
/** Starts outside the content silhouette rather than on a mesh lid or inside a splat. */
export function directEntryPoint(bounds: THREE.Box3, frame: GameFrame, forward: THREE.Vector3, eyeHeight: number, fov = 55, aspect = 16/9): THREE.Vector3 {
  const f = footprintInFrame(bounds, frame);
  const direction = forward.clone().applyQuaternion(frame.inverse).setY(0);
  if (direction.lengthSq() < 1e-12) direction.set(0, 0, -1);
  direction.normalize();
  const vertical = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(fov, 10, 120));
  const halfAngle = Math.min(vertical / 2, Math.atan(Math.tan(vertical / 2) * Math.max(.1, aspect)));
  const distance = bounds.getSize(new THREE.Vector3()).length() * .5 / Math.sin(halfAngle) + eyeHeight;
  return toWorld(frame, new THREE.Vector3((f.minX+f.maxX)/2 - direction.x * distance, 0, (f.minZ+f.maxZ)/2 - direction.z * distance));
}
