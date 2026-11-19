import { pickPrimary } from './fileSet';
import { PLY_HEADER_LIMIT } from './plyLimits';
import { plyHeaderBoundary } from './plyHeader';
import type { AssetSource, CompanionFile } from './types';

export type PlyKind = 'gaussian' | 'points' | 'not-ply';

export function extensionOf(name: string): string {
  const clean = name.split('?')[0]?.split('#')[0] ?? name;
  const base = clean.split(/[/\\]/).pop() ?? clean;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

/** ASCII header region of a PLY (stops at end_header when present). */
export function headerText(bytes: Uint8Array, max = PLY_HEADER_LIMIT): string {
  const slice = bytes.subarray(0, Math.min(bytes.length, max, PLY_HEADER_LIMIT));
  const text = new TextDecoder('latin1').decode(slice);
  const boundary = plyHeaderBoundary(text);
  if (boundary) return text.slice(0, boundary.headerEnd);
  return text;
}

/**
 * Distinguish 3DGS / compressed gaussian PLY from ordinary point-cloud PLY.
 * Compressed PlayCanvas PLY uses `element chunk` instead of f_dc_*.
 */
export function classifyPly(header: string): PlyKind {
  const trimmed = header.trimStart();
  if (!trimmed.toLowerCase().startsWith('ply')) return 'not-ply';
  const h = header.toLowerCase();
  let vertex = false;
  const coordinates = new Set<string>();
  for (const line of h.split(/\r?\n/)) {
    const element = /^\s*element\s+(\S+)/.exec(line);
    if (element?.[1] === 'chunk') return 'gaussian';
    if (element) vertex = element[1] === 'vertex';
    const name = /^\s*property\s+\S+\s+(\S+)\s*$/.exec(line)?.[1];
    if (vertex && name && (['f_dc_0', 'f_rest_0', 'scale_0'].includes(name) || name.startsWith('min_scale'))) return 'gaussian';
    const prop = /^\s*property\s+(char|uchar|short|ushort|int|uint|int8|uint8|int16|uint16|int32|uint32|float|float32|double|float64)\s+([xyz])\s*$/.exec(line);
    if (vertex && prop) coordinates.add(prop[2]);
  }
  if (coordinates.size === 3) return 'points';
  return 'not-ply';
}

export function isGlbMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
}

const GAUSSIAN_EXT = new Set(['splat', 'spz', 'ksplat', 'sog', 'rad', 'zip']);
const MESH_EXT = new Set(['glb', 'gltf', 'obj']);

export function sniffGaussian(source: AssetSource, header: Uint8Array): boolean | undefined {
  if (GAUSSIAN_EXT.has(source.extension)) return true;
  if (source.extension === 'ply' || source.extension === '') {
    const kind = classifyPly(headerText(header));
    if (kind === 'gaussian') return true;
    if (kind === 'points') return false;
    if (source.extension === 'ply') return false;
  }
  return undefined;
}

export function sniffPoints(source: AssetSource, header: Uint8Array): boolean | undefined {
  if (source.extension !== 'ply' && source.extension !== '') return undefined;
  const kind = classifyPly(headerText(header));
  if (kind === 'points') return true;
  if (kind === 'gaussian') return false;
  return undefined;
}

export function sniffMesh(source: AssetSource, header: Uint8Array): boolean | undefined {
  if (MESH_EXT.has(source.extension)) return true;
  if (isGlbMagic(header)) return true;
  return undefined;
}

/** Read a small prefix. Cancels the body so a range-unaware server cannot pull a multi-GB file. */
export async function readProbe(source: AssetSource, limit = 65536, signal?: AbortSignal): Promise<Uint8Array> {
  if (source.bytes) return new Uint8Array(source.bytes.slice(0, limit));
  if (source.file) return new Uint8Array(await source.file.slice(0, limit).arrayBuffer());
  if (!source.url) return new Uint8Array();

  const res = await fetch(source.url, {
    headers: { Range: `bytes=0-${limit - 1}` },
    signal,
  });
  if (!res.ok) {
    throw new Error(`Could not read ${source.name} (${res.status || 'network'})`);
  }
  if (!res.body) {
    throw new Error(`Could not read ${source.name}. The response had no body.`);
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  while (got < limit) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    const take = Math.min(value.byteLength, limit - got);
    chunks.push(value.slice(0, take));
    got += take;
  }
  await reader.cancel().catch(() => undefined);
  const out = new Uint8Array(Math.min(got, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.byteLength, out.length - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.length) break;
  }
  return out;
}

/** Resolve the complete bounded PLY header before assigning a representation. */
export async function readFormatProbe(source: AssetSource, signal?: AbortSignal): Promise<Uint8Array> {
  let bytes = await readProbe(source, 65536, signal);
  signal?.throwIfAborted();
  if (!/^\s*ply\r?\n/i.test(new TextDecoder('latin1').decode(bytes.subarray(0, 64)))) return bytes;
  const complete = (data: Uint8Array) => plyHeaderBoundary(new TextDecoder('latin1').decode(data)) !== null;
  if (!complete(bytes)) bytes = await readProbe(source, PLY_HEADER_LIMIT, signal);
  signal?.throwIfAborted();
  if (!complete(bytes)) throw new Error('PLY header is incomplete or exceeds the 1 MiB header limit.');
  return bytes;
}

export function sourceFromFile(file: File, origin: AssetSource['origin'] = 'file'): AssetSource {
  return {
    name: file.name,
    extension: extensionOf(file.name),
    origin,
    file,
    sizeBytes: file.size,
  };
}

/** Pick the scene file in a multi-file or folder selection. `sourceFromFile` is unchanged. */
export function sourceFromFiles(files: readonly CompanionFile[]): { source: AssetSource; ignored: string[] } | null {
  const picked = pickPrimary(files);
  if (!picked) return null;
  const file = picked.primary.file;
  return {
    source: {
      name: file.name,
      extension: extensionOf(file.name),
      origin: 'file',
      file,
      sizeBytes: file.size,
      companions: [picked.primary, ...picked.companions],
    },
    ignored: picked.ignored,
  };
}

export function sourceFromUrl(url: string, origin: AssetSource['origin'] = 'url'): AssetSource {
  let name = url;
  try {
    const parsed = new URL(url, 'https://local.invalid');
    name = decodeURIComponent(parsed.pathname.split('/').pop() || url);
  } catch {
    name = url.split('/').pop() || url;
  }
  return {
    name,
    extension: extensionOf(name),
    origin,
    url,
  };
}
