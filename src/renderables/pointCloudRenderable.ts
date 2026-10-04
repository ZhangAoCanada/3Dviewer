import * as THREE from 'three';
import type { Renderable, RenderableMeta, RenderableStats, RenderSettings } from '../core/types';
import type { PointCloudData } from '../loaders/points/parsePly';
import { nextId } from './ids';

export class PointCloudRenderable implements Renderable {
  readonly id = nextId('points');
  readonly kind = 'points' as const;
  readonly object: THREE.Points;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.PointsMaterial;
  private readonly baseSize: number;
  private readonly data: PointCloudData;

  constructor(
    readonly name: string,
    readonly meta: RenderableMeta,
    data: PointCloudData,
  ) {
    this.data = data;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    if (data.colors) {
      this.geometry.setAttribute('color', new THREE.BufferAttribute(data.colors, 3, true));
    }
    this.geometry.computeBoundingSphere();
    const radius = this.geometry.boundingSphere?.radius ?? 1;
    this.baseSize = Math.max(radius * 0.012, 0.004);
    this.material = new THREE.PointsMaterial({
      size: this.baseSize,
      sizeAttenuation: true,
      vertexColors: Boolean(data.colors),
      color: data.colors ? 0xffffff : 0x9fd8c8,
    });
    this.object = new THREE.Points(this.geometry, this.material);
    this.object.position.set(data.origin[0], data.origin[1], data.origin[2]);
    this.object.name = name;
    this.object.frustumCulled = true;
  }

  update(): void {}

  applySettings(settings: RenderSettings): void {
    this.material.size = this.baseSize * settings.pointSize;
    this.material.needsUpdate = true;
  }

  getStats(): RenderableStats {
    const memory = this.data.positions.byteLength + (this.data.colors?.byteLength ?? 0);
    return {
      kind: 'points',
      label: this.name,
      primitives: this.data.count,
      sourcePrimitives: this.data.sourceCount,
      vertices: this.data.count,
      memoryBytes: memory,
      extra: {
        stride: this.data.stride,
        subsampled: this.data.stride > 1 ? 'yes' : 'no',
      },
      detail: {
        sourceCount: this.data.sourceCount,
        retainedCount: this.data.count,
      },
    };
  }

  getBounds(): THREE.Box3 | null {
    this.object.updateWorldMatrix(true, false);
    return new THREE.Box3().setFromObject(this.object);
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.object.removeFromParent();
  }
}
