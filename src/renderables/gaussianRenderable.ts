import { SplatMesh, type SplatMesh as SplatMeshType } from '@sparkjsdev/spark';
import * as THREE from 'three';
import { epsgCode } from '../core/epsg';
import type { Renderable, RenderableMeta, RenderableStats, RenderSettings } from '../core/types';
import type { GaussianBounds, GaussianGeoref } from '../loaders/gaussian/decodeGaussianPly';
import { estimateDecodedBytes, type ShDegree } from '../loaders/gaussian/gaussianPlan';
import { nextId } from './ids';

type SplatMeshInstance = InstanceType<typeof SplatMesh>;

export interface GaussianSceneInfo {
  sourceCount: number;
  headerCount: number;
  shDegree: number;
  sourceSh: number;
  sampleStride: number;
  extended: boolean;
  /** Float32 centers were requested and half-float was used instead. */
  precisionReduced: boolean;
  lod: boolean;
  /** Splats in the LoD tree. Zero when LoD was not built. */
  lodCount: number;
  mismatch: boolean;
  warning?: string;
  georef?: GaussianGeoref;
  decodedBytes: number;
  bounds?: GaussianBounds;
  robustBounds?: GaussianBounds;
}

export class GaussianRenderable implements Renderable {
  readonly id = nextId('splats');
  readonly kind = 'splats' as const;
  readonly object: SplatMeshInstance;

  private cachedLocalBounds: THREE.Box3 | null = null;

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
    const want = Math.min(settings.shDegree, this.sceneInfo?.shDegree ?? 3);
    if (this.object.maxSh === want) return;
    this.object.maxSh = want;
    this.object.splats?.setMaxSh(want);
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
    const baseMemory = info?.decodedBytes ?? (bufferBytes(this.object) || count * (extended ? 64 : 32));
    const lodCount = info?.lodCount ?? 0;
    const memory =
      baseMemory + (lodCount > 0 ? estimateDecodedBytes(lodCount, shDegreeOf(info?.shDegree ?? 0), extended) : 0);
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
    if (lodCount > 0 && count > 0) {
      extra.lodSplats = `${lodCount.toLocaleString()} (×${(lodCount / count).toFixed(2)})`;
    }
    if (info?.mismatch) {
      extra.header = info.headerCount.toLocaleString();
      extra.body = info.sourceCount.toLocaleString();
    }
    const geo = info?.georef;
    const epsg = epsgCode(geo?.epsg);
    if (epsg) extra.epsg = epsg;
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
      detail: info
        ? {
            sourceCount: info.sourceCount,
            retainedCount: count,
            sourceSh: info.sourceSh,
            loadedSh: info.shDegree,
            precisionReduced: info.precisionReduced,
          }
        : undefined,
    };
  }

  getBounds(): THREE.Box3 | null {
    if (!this.object.isInitialized) return null;
    try {
      this.object.updateWorldMatrix(true, false);
      const local = this.localBounds();
      if (!local || local.isEmpty()) return null;
      return local.clone().applyMatrix4(this.object.matrixWorld);
    } catch {
      return null;
    }
  }

  private localBounds(): THREE.Box3 | null {
    const robust = this.sceneInfo?.robustBounds;
    if (robust) {
      return new THREE.Box3(
        new THREE.Vector3(robust.min[0], robust.min[1], robust.min[2]),
        new THREE.Vector3(robust.max[0], robust.max[1], robust.max[2]),
      );
    }
    if (this.cachedLocalBounds) return this.cachedLocalBounds;
    const box = this.object.getBoundingBox(true);
    if (box.isEmpty()) return null;
    this.cachedLocalBounds = box.clone();
    return this.cachedLocalBounds;
  }

  dispose(): void {
    this.object.dispose();
    this.object.removeFromParent();
  }
}

function shDegreeOf(value: number): ShDegree {
  if (value <= 0) return 0;
  if (value === 1) return 1;
  if (value === 2) return 2;
  return 3;
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
