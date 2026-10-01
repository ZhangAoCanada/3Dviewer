import * as THREE from 'three';
import { blobSource } from '../../core/byteSource';
import type { AssetSource, FormatLoader, LoadContext } from '../../core/types';
import { sniffPoints } from '../../core/sniff';
import { detectUpAxis } from '../../render/cameraMotion';
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

function parseInWorker(
  file: Blob,
  maxPoints: number,
  signal: AbortSignal,
  onProgress: (loaded: number, total: number) => void,
): Promise<PointCloudData> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/plyPoints.worker.ts', import.meta.url), {
      type: 'module',
    });
    let settled = false;
    const finish = (error?: Error, data?: PointCloudData) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
      if (error) reject(error);
      else if (data) resolve(data);
    };
    const onAbort = () => {
      const reason = signal.reason;
      const error =
        reason instanceof Error && reason.name !== 'AbortError'
          ? reason
          : new DOMException('Load aborted', 'AbortError');
      finish(error);
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    worker.onmessage = (
      event: MessageEvent<
        | { type: 'progress'; loaded: number; total: number }
        | { type: 'result'; data: PointCloudData }
        | { type: 'error'; message: string }
      >,
    ) => {
      const payload = event.data;
      if (payload.type === 'progress') {
        onProgress(payload.loaded, payload.total);
        return;
      }
      if (payload.type === 'result') {
        finish(undefined, payload.data);
        return;
      }
      if (payload.type === 'error') finish(new Error(payload.message || 'Point cloud parse failed'));
    };
    worker.onmessageerror = () => {
      finish(new Error('Point cloud parse result could not be transferred'));
    };
    worker.onerror = (event) => {
      finish(new Error(event.message || 'Point cloud worker failed'));
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
    const onProgress = (loaded: number, total: number) => {
      ctx.onProgress({
        loaded,
        total,
        stage: 'parse',
        message: 'Parsing point cloud',
      });
    };
    let data: PointCloudData;
    try {
      data = await parseInWorker(blob, ctx.budget.maxPoints, ctx.signal, onProgress);
    } catch (error) {
      if (ctx.signal.aborted || blob.size > 64 * 1024 * 1024) throw error;
      data = await parsePlyPoints(blobSource(blob), ctx.budget.maxPoints, onProgress);
    }
    if (ctx.signal.aborted) throw new DOMException('Load aborted', 'AbortError');
    if (!data.colors) data = { ...data, colors: colorizeByHeight(data.positions, upAxisOf(data.positions)) };
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

function upAxisOf(positions: Float32Array): 'y' | 'z' {
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] ?? 0;
    const y = positions[i + 1] ?? 0;
    const z = positions[i + 2] ?? 0;
    if (x < min.x) min.x = x;
    if (y < min.y) min.y = y;
    if (z < min.z) min.z = z;
    if (x > max.x) max.x = x;
    if (y > max.y) max.y = y;
    if (z > max.z) max.z = z;
  }
  if (!Number.isFinite(min.x)) return 'y';
  return detectUpAxis(max.sub(min));
}
