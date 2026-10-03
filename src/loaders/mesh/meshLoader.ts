import * as THREE from 'three';
import type { AssetSource, FormatLoader } from '../../core/types';
import { sniffMesh } from '../../core/sniff';
import { MeshRenderable } from '../../renderables/meshRenderable';

async function objectUrl(source: AssetSource): Promise<{ url: string; revoke: boolean }> {
  if (source.file) return { url: URL.createObjectURL(source.file), revoke: true };
  if (source.bytes) {
    const type = source.extension === 'obj' ? 'text/plain' : 'model/gltf-binary';
    return { url: URL.createObjectURL(new Blob([source.bytes], { type })), revoke: true };
  }
  if (source.url) return { url: source.url, revoke: false };
  throw new Error(`No data for ${source.name}`);
}

async function loadRoot(extension: string, url: string): Promise<THREE.Object3D> {
  if (extension === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    return new OBJLoader().loadAsync(url);
  }
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return (await new GLTFLoader().loadAsync(url)).scene;
}

function ensureMaterials(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const missing = materials.length === 0 || materials.some((material) => material == null);
    if (missing || mesh.material == null) {
      mesh.material = new THREE.MeshStandardMaterial({
        color: '#d5deea',
        metalness: 0.04,
        roughness: 0.62,
        side: THREE.DoubleSide,
      });
    }
  });
}

export const meshLoader: FormatLoader = {
  id: 'mesh-gltf-obj',
  label: 'Mesh',
  extensions: ['glb', 'gltf', 'obj'],
  kind: 'mesh',
  priority: 15,
  sniff: sniffMesh,
  async load(source, ctx) {
    const started = performance.now();
    ctx.onProgress({ loaded: 0, stage: 'parse', message: `Loading ${source.name}` });
    const { url, revoke } = await objectUrl(source);
    try {
      const root = await loadRoot(source.extension, url);
      if (ctx.signal.aborted) {
        const reason = ctx.signal.reason;
        if (reason instanceof Error && reason.name !== 'AbortError') throw reason;
        throw new DOMException('Load aborted', 'AbortError');
      }
      ensureMaterials(root);
      ctx.onProgress({ loaded: 1, total: 1, stage: 'ready', message: source.name });
      return new MeshRenderable(
        source.name,
        {
          fileName: source.name,
          loaderId: meshLoader.id,
          loadMs: performance.now() - started,
          bytes: source.sizeBytes ?? source.file?.size,
        },
        root,
      );
    } finally {
      if (revoke) URL.revokeObjectURL(url);
    }
  },
};
