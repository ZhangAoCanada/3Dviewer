import type { AssetSource, FormatLoader, LoadContext } from '../../core/types';
import { sniffPoints } from '../../core/sniff';
import { PointCloudRenderable } from '../../renderables/pointCloudRenderable';
import { colorizeByHeight, parsePlyPoints, type PointCloudData } from './parsePly';

async function blobOf(source: AssetSource, ctx: LoadContext): Promise<Blob> {
  if (source.file) return source.file;
  if (source.bytes) return new Blob([source.bytes]);
  if (!source.url) throw new Error(`No data for ${source.name}`);
  ctx.onProgress({ loaded: 0, stage: 'download', message: `Downloading ${source.name}` });
  const res = await fetch(source.url, { signal: ctx.signal });
  if (!res.ok) throw new Error(`Could not download ${source.name} (${res.status})`);
  return res.blob();
}

function parseInWorker(file: Blob, maxPoints: number): Promise<PointCloudData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/plyPoints.worker.ts', import.meta.url), {
      type: 'module',
    });
    const timer = window.setTimeout(() => {
      worker.terminate();
      reject(new Error('Point cloud parse timed out'));
    }, 120_000);
    worker.onmessage = (event: MessageEvent<({ ok: true } & PointCloudData) | { ok: false; error: string }>) => {
      window.clearTimeout(timer);
      worker.terminate();
      const data = event.data;
      if (!data.ok) {
        reject(new Error(data.error));
        return;
      }
      resolve(data);
    };
    worker.onerror = () => {
      window.clearTimeout(timer);
      worker.terminate();
      reject(new Error('Point cloud worker failed'));
    };
    worker.postMessage({ file, maxPoints });
  });
}

export const pointCloudLoader: FormatLoader = {
  id: 'point-cloud-ply',
  label: 'Point cloud PLY',
  extensions: ['ply'],
  kind: 'points',
  priority: 10,
  sniff: sniffPoints,
  async load(source, ctx) {
    const started = performance.now();
    const blob = await blobOf(source, ctx);
    ctx.onProgress({
      loaded: 0,
      total: blob.size,
      stage: 'parse',
      message: 'Parsing point cloud',
    });
    let data: PointCloudData;
    try {
      data = await parseInWorker(blob, ctx.budget.maxPoints);
    } catch (error) {
      if (ctx.signal.aborted) throw error;
      data = await parsePlyPoints(blob, ctx.budget.maxPoints);
    }
    if (ctx.signal.aborted) throw new DOMException('Load aborted', 'AbortError');
    if (!data.colors) data = { ...data, colors: colorizeByHeight(data.positions) };
    ctx.onProgress({
      loaded: data.count,
      total: data.sourceCount,
      stage: 'ready',
      message:
        data.stride > 1
          ? `${data.count.toLocaleString()} of ${data.sourceCount.toLocaleString()} points`
          : `${data.count.toLocaleString()} points`,
    });
    return new PointCloudRenderable(
      source.name,
      {
        fileName: source.name,
        loaderId: pointCloudLoader.id,
        loadMs: performance.now() - started,
        bytes: source.sizeBytes ?? blob.size,
      },
      data,
    );
  },
};
