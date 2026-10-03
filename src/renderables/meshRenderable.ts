import * as THREE from 'three';
import type { Renderable, RenderableMeta, RenderableStats, RenderSettings } from '../core/types';
import { disposeObject3D } from './disposeObject';
import { nextId } from './ids';

interface MeshSlot {
  mesh: THREE.Mesh;
  original: THREE.Material[];
  generated: THREE.Material[];
}

function asMaterials(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material];
}

function materialColor(material: THREE.Material | undefined): THREE.Color {
  if (material && 'color' in material && material.color instanceof THREE.Color) {
    return material.color.clone();
  }
  return new THREE.Color('#c5d0de');
}

function materialMap(material: THREE.Material | undefined): THREE.Texture | null {
  if (material && 'map' in material) {
    const map = (material as THREE.MeshStandardMaterial).map;
    return map ?? null;
  }
  return null;
}

function hasVertexColors(mesh: THREE.Mesh): boolean {
  return Boolean(mesh.geometry.getAttribute('color'));
}

export class MeshRenderable implements Renderable {
  readonly id = nextId('mesh');
  readonly kind = 'mesh' as const;
  readonly object: THREE.Object3D;
  private readonly slots: MeshSlot[] = [];
  private triangleCount = 0;
  private vertexCount = 0;
  private lastShading: RenderSettings['shading'] | null = null;
  private lastWireframe: boolean | null = null;

  constructor(
    readonly name: string,
    readonly meta: RenderableMeta,
    root: THREE.Object3D,
    private readonly facts?: { materials?: string; note?: string },
  ) {
    this.object = root;
    this.object.name = name;
    root.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (!mesh.geometry.getAttribute('normal')) mesh.geometry.computeVertexNormals();
      const position = mesh.geometry.getAttribute('position');
      if (position) this.vertexCount += position.count;
      const index = mesh.geometry.getIndex();
      this.triangleCount += index ? index.count / 3 : position ? position.count / 3 : 0;
      this.slots.push({
        mesh,
        original: asMaterials(mesh.material),
        generated: [],
      });
    });
  }

  update(): void {}

  applySettings(settings: RenderSettings): void {
    if (this.lastShading === settings.shading && this.lastWireframe === settings.wireframe) return;
    this.lastShading = settings.shading;
    this.lastWireframe = settings.wireframe;
    for (const slot of this.slots) {
      this.disposeGenerated(slot);
      const source = slot.original[0];
      if (settings.shading === 'normals') {
        const material = new THREE.MeshNormalMaterial({ wireframe: settings.wireframe });
        slot.generated = [material];
        slot.mesh.material = material;
        continue;
      }
      if (settings.shading === 'flat') {
        const material = new THREE.MeshBasicMaterial({
          color: materialColor(source),
          map: materialMap(source),
          vertexColors: hasVertexColors(slot.mesh),
          wireframe: settings.wireframe,
          side: THREE.DoubleSide,
        });
        slot.generated = [material];
        slot.mesh.material = material;
        continue;
      }
      const clones = slot.original.map((material) => {
        const clone = material.clone();
        if ('wireframe' in clone) {
          (clone as THREE.MeshStandardMaterial).wireframe = settings.wireframe;
        }
        if ('side' in clone) {
          (clone as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
        }
        return clone;
      });
      slot.generated = clones;
      slot.mesh.material = clones.length === 1 ? (clones[0] as THREE.Material) : clones;
    }
  }

  getStats(): RenderableStats {
    let memory = 0;
    this.object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) return;
      const geo = mesh.geometry;
      for (const attribute of Object.values(geo.attributes)) {
        memory += attribute.array.byteLength;
      }
      if (geo.index) memory += geo.index.array.byteLength;
    });
    const extra: Record<string, string | number> = {};
    if (this.facts?.materials) extra.materials = this.facts.materials;
    if (this.facts?.note) extra.note = this.facts.note;
    return {
      kind: 'mesh',
      label: this.name,
      primitives: this.triangleCount,
      triangles: this.triangleCount,
      vertices: this.vertexCount,
      memoryBytes: memory,
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    };
  }

  getBounds(): THREE.Box3 | null {
    this.object.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(this.object);
    return box.isEmpty() ? null : box;
  }

  dispose(): void {
    for (const slot of this.slots) {
      this.disposeGenerated(slot);
      slot.mesh.material = slot.original.length === 1 ? (slot.original[0] as THREE.Material) : slot.original;
    }
    disposeObject3D(this.object);
  }

  private disposeGenerated(slot: MeshSlot): void {
    for (const material of slot.generated) material.dispose();
    slot.generated = [];
  }
}
