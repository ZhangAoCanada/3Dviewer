import * as THREE from 'three';
import type { NavigationController, NavSnapshot } from '../render/Navigation';
export interface GameViewSnapshot {
  navigation: NavSnapshot;
  quaternion: THREE.Quaternion;
  cameraUp: THREE.Vector3;
  near: number;
  far: number;
  fov: number;
}
export function captureGameView(camera: THREE.PerspectiveCamera, navigation: NavigationController): GameViewSnapshot {
  return { navigation: navigation.snapshot(), quaternion: camera.quaternion.clone(), cameraUp: camera.up.clone(),
    near: camera.near, far: camera.far, fov: camera.fov };
}
export function restoreGameView(saved: GameViewSnapshot, camera: THREE.PerspectiveCamera, navigation: NavigationController): void {
  navigation.restore(saved.navigation);
  camera.quaternion.copy(saved.quaternion);
  camera.up.copy(saved.cameraUp);
  camera.near = saved.near;
  camera.far = saved.far;
  camera.fov = saved.fov;
  camera.updateProjectionMatrix();
}
