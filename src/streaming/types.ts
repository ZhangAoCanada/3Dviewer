/**
 * Contracts for the large-scene workstream.
 * Phase 1 does not ship a second streamer: Spark's .RAD pager and worker LOD
 * are the gaussian implementation, and point clouds subsample under MemoryBudget.
 * New streamers should implement ChunkStreamer and register with the scene host
 * without changing FormatLoader.
 */

export interface Aabb {
  min: [number, number, number];
  max: [number, number, number];
}

export interface SpatialChunk {
  lod: number;
  url: string;
  count: number;
  byteLength?: number;
}

export interface SpatialNode {
  id: string;
  bounds: Aabb;
  children?: SpatialNode[];
  chunks?: SpatialChunk[];
}

export type StreamFormat = 'rad-paged' | 'streamed-sog' | 'potree-octree' | 'custom';

export interface StreamManifest {
  format: StreamFormat;
  totalPrimitives: number;
  tree: SpatialNode;
}

export interface ChunkRequest {
  url: string;
  lod: number;
  priority: number;
}

/**
 * Viewpoint-driven fetch + eviction. Implementations must bound GPU memory
 * by the active MemoryBudget and cancel in-flight work on AbortSignal.
 */
export interface ChunkStreamer {
  readonly format: StreamFormat;
  open(url: string, signal: AbortSignal): Promise<StreamManifest>;
  prefetch(requests: ChunkRequest[], signal: AbortSignal): Promise<void>;
  evict(predicate: (request: ChunkRequest) => boolean): void;
  dispose(): void;
}

/**
 * Placeholder so the streaming folder has a concrete export tests can import.
 * The 3DGS workstream replaces this with a RAD/SOG pager adapter.
 */
export class UnimplementedStreamer implements ChunkStreamer {
  constructor(readonly format: StreamFormat) {}

  open(_url: string, _signal: AbortSignal): Promise<StreamManifest> {
    return Promise.reject(
      new Error(`${this.format} streaming is a Phase 2 workstream. See ARCHITECTURE.md.`),
    );
  }

  prefetch(_requests: ChunkRequest[], _signal: AbortSignal): Promise<void> {
    return Promise.reject(new Error(`${this.format} streaming is not implemented.`));
  }

  evict(): void {}

  dispose(): void {}
}
