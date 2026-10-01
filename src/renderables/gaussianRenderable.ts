import { SplatMesh, type SplatMesh as SplatMeshType } from '@sparkjsdev/spark';
import * as THREE from 'three';
import type { Renderable, RenderableMeta, RenderableStats, RenderSettings } from '../core/types';
import type { GaussianGeoref } from '../loaders/gaussian/decodeGaussianPly';
import { nextId } from './ids';

type SplatMeshInstance = InstanceType<typeof SplatMesh>;

export interface GaussianSceneInfo {
  sourceCount: number;
  headerCount: number;
  shDegree: number;
  sourceSh: number;
  sampleStride: number;
  extended: boolean;
  lod: boolean;
  mismatch: boolean;
  warning?: string;
  georef?: GaussianGeoref;
  decodedBytes: number;
}

export class GaussianRenderable implements Renderable {
  readonly id = nextId('splats');
  readonly kind = 'splats' as const;
  readonly object: SplatMeshInstance;

  constructor(
    readonly name: string,
    readonly meta: RenderableMeta,
    mesh: SplatMeshInstance,
    private readonly sceneInfo?: GaussianSceneInfo,
  ) {
    this.object = mesh;
    this.object.name = name;
    (this.object as SplatMeshInstance & { raycastable?: boolean }).raycastable = false;
  }

  update(): void {}

  applySettings(settings: RenderSettings): void {
    this.object.lodScale = settings.lodSplatScale;
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
    const info = this.sceneInfo;
    const extended = info ? info.extended : Boolean(this.object.extSplats);
    const memory = info?.decodedBytes ?? (bufferBytes(this.object) || count * (extended ? 64 : 32));
    const shText = info
      ? info.shDegree === info.sourceSh
        ? String(info.shDegree)
        : `${info.shDegree} of ${info.sourceSh}`
      : String(this.object.maxSh);
    const extra: Record<string, string | number> = {
      encoding: extended ? 'float32 centers' : 'half-float centers',
      lod: info ? (info.lod ? 'on' : 'off') : this.object.enableLod ? 'on' : 'off',
      sh: shText,
    };
    if (info && info.sampleStride > 1) extra.stride = info.sampleStride;
    if (info?.mismatch) {
      extra.header = info.headerCount.toLocaleString();
      extra.body = info.sourceCount.toLocaleString();
    }
    const geo = info?.georef;
    if (geo?.epsg) extra.epsg = geo.epsg;
    if (geo?.offsetX || geo?.offsetY || geo?.offsetZ) {
      extra.offset = [geo.offsetX ?? '—', geo.offsetY ?? '—', geo.offsetZ ?? '—'].join(', ');
    }
    if (geo?.minX && geo?.minY && geo?.minZ && geo?.maxX && geo?.maxY && geo?.maxZ) {
      extra.bounds = `${geo.minX} ${geo.minY} ${geo.minZ} → ${geo.maxX} ${geo.maxY} ${geo.maxZ}`;
    }
    if (info?.warning) extra.note = info.warning;
    return {
      kind: 'splats',
      label: this.name,
      primitives: count,
      sourcePrimitives: info?.sourceCount,
      memoryBytes: memory,
      extra,
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

function bufferBytes(mesh: SplatMeshInstance): number {
  let bytes = 0;
  const packed = mesh.packedSplats?.packedArray;
  if (packed) bytes += packed.byteLength;
  const ext = mesh.extSplats?.extArrays;
  if (ext) bytes += ext[0].byteLength + ext[1].byteLength;
  const extra = mesh.packedSplats?.extra ?? mesh.extSplats?.extra;
  if (extra) {
    for (const value of Object.values(extra)) {
      if (value instanceof Uint32Array) bytes += value.byteLength;
    }
  }
  return bytes;
}

export function splatCount(mesh: SplatMeshType): number {
  return mesh.packedSplats?.numSplats ?? mesh.extSplats?.numSplats ?? mesh.splats?.getNumSplats() ?? 0;
}
