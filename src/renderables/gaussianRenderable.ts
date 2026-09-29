import { SplatMesh, type SplatMesh as SplatMeshType } from '@sparkjsdev/spark';
import * as THREE from 'three';
import type { Renderable, RenderableMeta, RenderableStats, RenderSettings } from '../core/types';
import { nextId } from './ids';

type SplatMeshInstance = InstanceType<typeof SplatMesh>;

export class GaussianRenderable implements Renderable {
  readonly id = nextId('splats');
  readonly kind = 'splats' as const;
  readonly object: SplatMeshInstance;

  constructor(
    readonly name: string,
    readonly meta: RenderableMeta,
    mesh: SplatMeshInstance,
  ) {
    this.object = mesh;
    this.object.name = name;
  }

  update(): void {}

  applySettings(settings: RenderSettings): void {
    if (this.object.maxSh === settings.shDegree) return;
    this.object.maxSh = settings.shDegree;
    this.object.splats?.setMaxSh(settings.shDegree);
    try {
      this.object.updateGenerator();
    } catch {
      /* The generator is rebuilt once the packed splats finish uploading. */
    }
  }

  getStats(): RenderableStats {
    const count = splatCount(this.object);
    const extended = Boolean(this.object.extSplats);
    const bytesPer = extended ? 64 : 32;
    return {
      kind: 'splats',
      label: this.name,
      primitives: count,
      memoryBytes: count * bytesPer,
      extra: {
        encoding: extended ? 'extended' : 'packed',
        lod: this.object.enableLod ? 'on' : 'off',
        sh: this.object.maxSh,
      },
    };
  }

  getBounds(): THREE.Box3 | null {
    if (!this.object.isInitialized) return null;
    try {
      this.object.updateWorldMatrix(true, false);
      const box = this.object.getBoundingBox(true);
      if (box.isEmpty()) return null;
      return box.applyMatrix4(this.object.matrixWorld);
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.object.dispose();
    this.object.removeFromParent();
  }
}

export function splatCount(mesh: SplatMeshType): number {
  return mesh.packedSplats?.numSplats ?? mesh.extSplats?.numSplats ?? mesh.splats?.getNumSplats() ?? 0;
}
