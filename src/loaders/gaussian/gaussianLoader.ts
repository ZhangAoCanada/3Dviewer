import { SplatFileType, SplatMesh, type SplatMeshOptions } from '@sparkjsdev/spark';
import type { AssetSource, FormatLoader, LoadContext } from '../../core/types';
import { sniffGaussian } from '../../core/sniff';
import { GaussianRenderable, splatCount } from '../../renderables/gaussianRenderable';

const FILE_TYPES: Record<string, SplatFileType> = {
  ply: SplatFileType.PLY,
  splat: SplatFileType.SPLAT,
  ksplat: SplatFileType.KSPLAT,
  spz: SplatFileType.SPZ,
  sog: SplatFileType.PCSOGSZIP,
  zip: SplatFileType.PCSOGSZIP,
  rad: SplatFileType.RAD,
};

/** Above this, hand Spark a stream instead of one contiguous byte array. */
const STREAM_BYTES = 16 * 1024 * 1024;
/** Float32 centers for survey-scale coordinates. */
const EXTENDED_BYTES = 80 * 1024 * 1024;
/** Worker LOD only pays off once the splat count is large. */
const LOD_ABOVE = 400_000;

async function contentLength(url: string, signal: AbortSignal): Promise<number | undefined> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal });
    const value = Number(res.headers.get('content-length'));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Load aborted', 'AbortError');
}

export const gaussianLoader: FormatLoader = {
  id: 'gaussian-splats',
  label: 'Gaussian splats',
  extensions: ['ply', 'splat', 'spz', 'ksplat', 'sog', 'zip', 'rad'],
  kind: 'splats',
  priority: 20,
  sniff: sniffGaussian,
  async load(source: AssetSource, ctx: LoadContext) {
    const started = performance.now();
    ctx.onProgress({ loaded: 0, stage: 'download', message: `Reading ${source.name}` });
    const size = source.sizeBytes ?? (source.url ? await contentLength(source.url, ctx.signal) : undefined);
    throwIfAborted(ctx.signal);
    const extended = ctx.extendedPrecision || (size !== undefined && size >= EXTENDED_BYTES);

    const options: SplatMeshOptions = {
      fileName: source.name,
      lod: true,
      lodAbove: LOD_ABOVE,
      extSplats: extended,
      onProgress: (event) => {
        const total = event.total > 0 ? event.total : size;
        ctx.onProgress({
          loaded: event.loaded,
          total,
          stage: 'parse',
          message: `Decoding ${source.name}`,
        });
      },
    };
    const fileType = FILE_TYPES[source.extension];
    if (fileType) options.fileType = fileType;
    if (source.extension === 'rad') options.paged = true;

    if (source.file) {
      if (source.file.size >= STREAM_BYTES) {
        options.stream = source.file.stream();
        options.streamLength = source.file.size;
      } else {
        options.fileBytes = new Uint8Array(await source.file.arrayBuffer());
      }
    } else if (source.bytes) {
      options.fileBytes = new Uint8Array(source.bytes);
    } else if (source.url) {
      options.url = source.url;
    } else {
      throw new Error(`No data for ${source.name}`);
    }

    throwIfAborted(ctx.signal);
    const mesh = new SplatMesh(options);
    try {
      await mesh.initialized;
    } catch (error) {
      mesh.dispose();
      throw error;
    }
    throwIfAborted(ctx.signal);
    const count = splatCount(mesh);
    ctx.onProgress({
      loaded: count,
      total: count,
      stage: 'ready',
      message: `${count.toLocaleString()} splats`,
    });
    return new GaussianRenderable(
      source.name,
      {
        fileName: source.name,
        loaderId: gaussianLoader.id,
        loadMs: performance.now() - started,
        bytes: size ?? source.file?.size,
      },
      mesh,
    );
  },
};
