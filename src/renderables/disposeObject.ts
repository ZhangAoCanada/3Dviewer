import * as THREE from 'three';

function isTexture(value: unknown): value is THREE.Texture {
  return Boolean(value) && typeof value === 'object' && (value as THREE.Texture).isTexture === true;
}

function collectTextures(material: THREE.Material, textures: Set<THREE.Texture>): void {
  for (const value of Object.values(material)) {
    if (isTexture(value)) textures.add(value);
  }
  const uniforms = (material as { uniforms?: Record<string, { value?: unknown }> }).uniforms;
  if (!uniforms) return;
  for (const uniform of Object.values(uniforms)) {
    if (isTexture(uniform?.value)) textures.add(uniform.value);
  }
}

function closeBitmap(texture: THREE.Texture): void {
  const data = texture.source?.data as { close?: unknown } | null | undefined;
  if (data && typeof data.close === 'function') data.close();
}

/**
 * Release geometries, materials, and textures for a loaded scene, including
 * ImageBitmaps GLTFLoader leaves on the texture source.
 */
export function disposeObject3D(root: THREE.Object3D): { geometries: number; materials: number; textures: number } {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const withSkeleton = object as THREE.Object3D & { skeleton?: { dispose?: () => void } };
    withSkeleton.skeleton?.dispose?.();
    const geometry = (object as { geometry?: THREE.BufferGeometry }).geometry;
    if (geometry) geometries.add(geometry);
    const material = (object as { material?: THREE.Material | THREE.Material[] }).material;
    if (!material) return;
    const list = Array.isArray(material) ? material : [material];
    for (const item of list) {
      if (item) materials.add(item);
    }
  });
  const textures = new Set<THREE.Texture>();
  for (const material of materials) collectTextures(material, textures);
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) {
    closeBitmap(texture);
    texture.dispose();
  }
  root.removeFromParent();
  return { geometries: geometries.size, materials: materials.size, textures: textures.size };
}
