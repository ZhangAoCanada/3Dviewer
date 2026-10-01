import { ExtSplats, PackedSplats, SplatFileType, SplatMesh, type SplatMeshOptions } from '@sparkjsdev/spark';
import { blobSource, rangeSource, type ByteSource } from '../../core/byteSource';
import type { AssetSource, FormatLoader, LoadContext, MemoryBudget } from '../../core/types';
import { sniffGaussian } from '../../core/sniff';
import { GaussianRenderable, splatCount, type GaussianSceneInfo } from '../../renderables/gaussianRenderable';
import { decodeGaussianPly, GaussianPlyUnsupported, inspectGaussianPly, type DecodedGaussian } from './decodeGaussianPly';
import { disposeIfAborted, throwIfAborted } from './disposeIfAborted';
import { explainLoadError } from './explainLoadError';

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
/** Float32 centers when the decoded scene can afford them. Drone PLYs are far past this. */
const EXTENDED_BYTES = 80 * 1024 * 1024;
const LOD_ABOVE = 400_000;

interface HeadProbe {
  size?: number;
  acceptRanges: boolean;
}

async function probeHead(url: string, signal: AbortSignal): Promise<HeadProbe> {
  try {
    const res = await fetch(url, { method: 'HEAD', signal });
    const value = Number(res.headers.get('content-length'));
    const size = Number.isFinite(value) && value > 0 ? value : undefined;
    const accept = (res.headers.get('accept-ranges') ?? '').toLowerCase();
    return { size, acceptRanges: accept.includes('bytes') };
  } catch {
    return { acceptRanges: false };
  }
}

async function blobOf(source: AssetSource, ctx: LoadContext): Promise<Blob> {
  if (source.file) return source.file;
  if (source.bytes) return new Blob([source.bytes]);
  if (!source.url) throw new Error(`No data for ${source.name}`);
  ctx.onProgress({ loaded: 0, stage: 'download', message: `Downloading ${source.name}` });
  const res = await fetch(source.url, { signal: ctx.signal });
  if (!res.ok) throw new Error(`Could not download ${source.name} (${res.status})`);
  return res.blob();
}

type DecodeRequest =
  | { blob: Blob; budget: MemoryBudget; preferExtended: boolean }
  | { url: string; size: number; budget: MemoryBudget; preferExtended: boolean };

function decodeInWorker(request: DecodeRequest, ctx: LoadContext): Promise<DecodedGaussian> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/gaussianPly.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error?: Error, data?: DecodedGaussian) => {
      if (settled) return;
      settled = true;
      ctx.signal.removeEventListener('abort', onAbort);
      worker.terminate();
      if (error) reject(error);
      else if (data) resolve(data);
    };
    const onAbort = () => {
      const reason = ctx.signal.reason;
      const error =
        reason instanceof Error && reason.name !== 'AbortError'
          ? reason
          : new DOMException('Load aborted', 'AbortError');
      finish(error);
    };
    if (ctx.signal.aborted) {
      onAbort();
      return;
    }
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (event: MessageEvent<{ type: string; progress?: { loaded: number; total: number; message: string }; data?: DecodedGaussian; message?: string; name?: string }>) => {
      const payload = event.data;
      if (payload.type === 'progress' && payload.progress) {
        ctx.onProgress({
          loaded: payload.progress.loaded,
          total: payload.progress.total,
          stage: 'parse',
          message: payload.progress.message,
        });
        return;
      }
      if (payload.type === 'result' && payload.data) {
        finish(undefined, payload.data);
        return;
      }
      if (payload.type === 'error') {
        const error = new Error(payload.message || 'Gaussian decode failed');
        if (payload.name) error.name = payload.name;
        finish(error);
      }
    };
    worker.onmessageerror = () => {
      finish(new Error('Gaussian decode result could not be transferred'));
    };
    worker.onerror = (event) => {
      finish(new Error(event.message || 'Gaussian decode worker failed'));
    };
    worker.postMessage(request);
  });
}

function sceneInfo(decoded: DecodedGaussian, lodBuilt: boolean): GaussianSceneInfo {
  return {
    sourceCount: decoded.sourceCount,
    headerCount: decoded.headerCount,
    shDegree: decoded.shDegree,
    sourceSh: decoded.sourceSh,
    sampleStride: decoded.stride,
    extended: decoded.extended,
    lod: lodBuilt,
    mismatch: decoded.mismatch,
    warning: decoded.warning,
    georef: decoded.georef,
    decodedBytes: decoded.decodedBytes,
    bounds: decoded.bounds,
    robustBounds: decoded.robustBounds,
  };
}

async function meshFromDecoded(decoded: DecodedGaussian, name: string, ctx: LoadContext): Promise<{ mesh: SplatMesh; lodBuilt: boolean }> {
  throwIfAborted(ctx.signal);
  const encoding = {
    rgbMin: decoded.limits.rgbMin,
    rgbMax: decoded.limits.rgbMax,
    lnScaleMin: decoded.limits.lnScaleMin,
    lnScaleMax: decoded.limits.lnScaleMax,
    sh1Max: decoded.limits.sh1Max,
    sh2Max: decoded.limits.sh2Max,
    sh3Max: decoded.limits.sh3Max,
  };
  const extra: Record<string, Uint32Array> = {};
  if (decoded.sh1) extra.sh1 = decoded.sh1;
  if (decoded.sh2) extra.sh2 = decoded.sh2;
  if (decoded.extended) {
    if (decoded.sh3) extra.sh3a = decoded.sh3;
    if (decoded.sh3b) extra.sh3b = decoded.sh3b;
  } else if (decoded.sh3) {
    extra.sh3 = decoded.sh3;
  }

  let mesh: SplatMesh;
  if (decoded.extended && decoded.extArrays) {
    const ext = new ExtSplats({
      extArrays: decoded.extArrays,
      numSplats: decoded.count,
      extra,
    });
    mesh = new SplatMesh({
      extSplats: ext,
      fileName: name,
      raycastable: false,
    });
  } else if (decoded.packedArray) {
    const packed = new PackedSplats({
      packedArray: decoded.packedArray,
      numSplats: decoded.count,
      extra,
      splatEncoding: encoding,
    });
    mesh = new SplatMesh({
      packedSplats: packed,
      fileName: name,
      splatEncoding: encoding,
      raycastable: false,
    });
  } else {
    throw new Error('Gaussian decode produced no splat buffer.');
  }
  mesh.position.set(decoded.origin[0], decoded.origin[1], decoded.origin[2]);
  let disposed = false;
  const release = () => {
    if (disposed) return;
    disposed = true;
    mesh.dispose();
  };
  try {
    mesh.maxSh = decoded.shDegree;
    mesh.numSplats = decoded.count;
    ctx.onProgress({
      loaded: decoded.count,
      total: decoded.sourceCount,
      stage: 'gpu',
      message: `Uploading ${decoded.count.toLocaleString()} splats`,
    });
    await mesh.initialized;
    disposeIfAborted({ dispose: release }, ctx.signal);
    let lodBuilt = false;
    if (decoded.lod) {
      ctx.onProgress({
        loaded: decoded.count,
        total: decoded.count,
        stage: 'gpu',
        message: `Building level of detail for ${decoded.count.toLocaleString()} splats`,
      });
      try {
        await mesh.createLodSplats();
        disposeIfAborted({ dispose: release }, ctx.signal);
        mesh.enableLod = true;
        lodBuilt = true;
      } catch (error) {
        if (ctx.signal.aborted) {
          release();
          throwIfAborted(ctx.signal);
        }
        const note = `Level of detail was skipped (${explainLoadError(error)}).`;
        decoded.warning = decoded.warning ? `${decoded.warning} ${note}` : note;
        decoded.notes.push(note);
      }
    }
    return { mesh, lodBuilt };
  } catch (error) {
    release();
    throw error;
  }
}

type StandardPlyInput = { kind: 'blob'; blob: Blob } | { kind: 'range'; url: string; size: number };

function standardSource(input: StandardPlyInput, signal: AbortSignal): ByteSource {
  return input.kind === 'blob' ? blobSource(input.blob) : rangeSource(input.url, input.size, signal);
}

async function loadStandardPly(
  source: AssetSource,
  input: StandardPlyInput,
  ctx: LoadContext,
  started: number,
): Promise<GaussianRenderable> {
  const size = source.sizeBytes ?? (input.kind === 'blob' ? input.blob.size : input.size);
  const preferExtended = ctx.extendedPrecision || size >= EXTENDED_BYTES;
  let decoded: DecodedGaussian;
  try {
    decoded = await decodeInWorker(
      input.kind === 'blob'
        ? { blob: input.blob, budget: ctx.budget, preferExtended }
        : { url: input.url, size: input.size, budget: ctx.budget, preferExtended },
      ctx,
    );
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    const name = error instanceof Error ? error.name : '';
    if (name === 'GaussianPlyError' || name === 'GaussianPlyUnsupported') throw error;
    if (size > 64 * 1024 * 1024) throw new Error(explainLoadError(error));
    decoded = await decodeGaussianPly(standardSource(input, ctx.signal), {
      budget: ctx.budget,
      preferExtended,
      signal: ctx.signal,
      onProgress: (progress) => {
        ctx.onProgress({ ...progress, stage: 'parse' });
      },
    });
  }
  throwIfAborted(ctx.signal);
  const { mesh, lodBuilt } = await meshFromDecoded(decoded, source.name, ctx);
  ctx.onProgress({
    loaded: decoded.count,
    total: decoded.sourceCount,
    stage: 'ready',
    message: `${decoded.count.toLocaleString()} splats`,
  });
  return new GaussianRenderable(
    source.name,
    {
      fileName: source.name,
      loaderId: gaussianLoader.id,
      loadMs: performance.now() - started,
      bytes: size,
    },
    mesh,
    sceneInfo(decoded, lodBuilt),
  );
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
    const head: HeadProbe = source.url ? await probeHead(source.url, ctx.signal) : { acceptRanges: false };
    throwIfAborted(ctx.signal);
    const size = source.sizeBytes ?? head.size ?? source.file?.size ?? source.bytes?.byteLength;
    const useRange = !source.file && !source.bytes && Boolean(source.url) && size !== undefined && head.acceptRanges;

    if (source.extension === 'ply' || source.extension === '') {
      if (useRange && source.url && size !== undefined) {
        const header = await inspectGaussianPly(rangeSource(source.url, size, ctx.signal));
        if (header) {
          try {
            return await loadStandardPly(source, { kind: 'range', url: source.url, size }, ctx, started);
          } catch (error) {
            if (error instanceof GaussianPlyUnsupported) {
              /* Compressed or unusual PLY still goes through Spark. */
            } else {
              throw new Error(explainLoadError(error));
            }
          }
        }
      } else {
        const blob = await blobOf(source, ctx);
        throwIfAborted(ctx.signal);
        const header = await inspectGaussianPly(blobSource(blob));
        if (header) {
          try {
            return await loadStandardPly(source, { kind: 'blob', blob }, ctx, started);
          } catch (error) {
            if (error instanceof GaussianPlyUnsupported) {
              /* Compressed or unusual PLY still goes through Spark. */
            } else {
              throw new Error(explainLoadError(error));
            }
          }
        }
      }
    }

    return loadViaSpark(source, ctx, started, size);
  },
};

async function loadViaSpark(
  source: AssetSource,
  ctx: LoadContext,
  started: number,
  size: number | undefined,
): Promise<GaussianRenderable> {
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
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      source.file.stream().pipeTo(stream.writable, { signal: ctx.signal }).catch(() => {});
      options.stream = stream.readable;
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
  let disposed = false;
  const release = () => {
    if (disposed) return;
    disposed = true;
    mesh.dispose();
  };
  const onAbort = () => release();
  ctx.signal.addEventListener('abort', onAbort);
  try {
    await mesh.initialized;
    disposeIfAborted({ dispose: release }, ctx.signal);
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
  } catch (error) {
    release();
    throw new Error(explainLoadError(error));
  } finally {
    ctx.signal.removeEventListener('abort', onAbort);
  }
}
