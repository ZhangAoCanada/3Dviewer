import { PackedSplats, SplatMesh } from '@sparkjsdev/spark';
import { DEFAULT_LIMITS, writePackedSplat } from '../loaders/gaussian/packSplat';
import { GaussianRenderable, type GaussianSceneInfo } from '../renderables/gaussianRenderable';

/** A wide, short Z-up cloud shaped like a drone scan. Used by `?demo=slab`. */
export async function createDemoSlab(count = 48_000): Promise<GaussianRenderable> {
  const columns = 240;
  const rows = Math.ceil(count / columns);
  const packed = new Uint32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    const x = (col / (columns - 1)) * 590;
    const y = (row / Math.max(1, rows - 1)) * 490;
    const z = 12 + 22 * Math.sin(x * 0.018) * Math.cos(y * 0.014) + ((i * 13) % 9);
    const shade = 0.28 + (z / 70) * 0.55;
    writePackedSplat(packed, i, x, y, z, 1.15, 1.15, 0.55, 0, 0, 0, 1, 0.92, 0.42 + shade * 0.2, shade, 0.32);
  }
  const encoding = {
    rgbMin: DEFAULT_LIMITS.rgbMin,
    rgbMax: DEFAULT_LIMITS.rgbMax,
    lnScaleMin: DEFAULT_LIMITS.lnScaleMin,
    lnScaleMax: DEFAULT_LIMITS.lnScaleMax,
    sh1Max: DEFAULT_LIMITS.sh1Max,
    sh2Max: DEFAULT_LIMITS.sh2Max,
    sh3Max: DEFAULT_LIMITS.sh3Max,
  };
  const mesh = new SplatMesh({
    packedSplats: new PackedSplats({ packedArray: packed, numSplats: count, splatEncoding: encoding }),
    fileName: 'synthetic-slab.ply',
    splatEncoding: encoding,
    raycastable: false,
  });
  mesh.maxSh = 0;
  mesh.numSplats = count;
  await mesh.initialized;
  mesh.enableLod = false;
  const info: GaussianSceneInfo = {
    sourceCount: count,
    headerCount: count,
    shDegree: 0,
    sourceSh: 0,
    sampleStride: 1,
    extended: false,
    lod: false,
    mismatch: false,
    decodedBytes: packed.byteLength,
  };
  return new GaussianRenderable(
    'Synthetic drone slab',
    { fileName: 'synthetic-slab.ply', loaderId: 'demo', loadMs: 0, bytes: packed.byteLength },
    mesh,
    info,
  );
}
