import type { CompanionFile } from './types';

const SCENE_ORDER = ['glb', 'gltf', 'obj', 'rad', 'spz', 'sog', 'ksplat', 'splat', 'ply', 'zip'] as const;
const SCENE_RANK = new Map<string, number>(SCENE_ORDER.map((ext, index) => [ext, index]));

export interface PickedFiles {
  primary: CompanionFile;
  companions: CompanionFile[];
  ignored: string[];
}

export interface GltfRefs {
  buffers: string[];
  images: string[];
  required: string[];
}

function extensionOfPath(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

function baseName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? path;
}

function depthOf(path: string): number {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part.length > 0 && part !== '.').length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Scene file to open, plus the other files that may belong to it. */
export function pickPrimary(files: readonly CompanionFile[]): PickedFiles | null {
  const scenes = files.filter((file) => SCENE_RANK.has(extensionOfPath(file.path)));
  if (scenes.length === 0) return null;
  const ranked = [...scenes].sort((a, b) => {
    const rank = (SCENE_RANK.get(extensionOfPath(a.path)) ?? 0) - (SCENE_RANK.get(extensionOfPath(b.path)) ?? 0);
    if (rank !== 0) return rank;
    const depth = depthOf(a.path) - depthOf(b.path);
    if (depth !== 0) return depth;
    return a.path.localeCompare(b.path);
  });
  const primary = ranked[0];
  if (!primary) return null;
  const ignoredFiles = ranked.slice(1);
  const ignoredSet = new Set(ignoredFiles);
  return {
    primary,
    companions: files.filter((file) => file !== primary && !ignoredSet.has(file)),
    ignored: ignoredFiles.map((file) => file.file.name || baseName(file.path)),
  };
}

function decodeRef(ref: string): string {
  const slashed = ref.replace(/\\/g, '/');
  try {
    return decodeURIComponent(slashed);
  } catch {
    return slashed;
  }
}

function isAbsoluteRef(ref: string): boolean {
  return ref.startsWith('/') || /^[a-zA-Z]:/.test(ref);
}

/** Path of `ref` relative to the primary file's folder, with `.` and `..` resolved. */
export function normalizeCompanionPath(ref: string, baseDir: string): string {
  const decoded = decodeRef(ref);
  const combined = isAbsoluteRef(decoded) ? decoded : joinPath(baseDir, decoded);
  const stack: string[] = [];
  for (const part of combined.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

function joinPath(base: string, rel: string): string {
  if (!base) return rel;
  return `${base.replace(/\/+$/, '')}/${rel}`;
}

function byShallowPath(files: readonly CompanionFile[]): CompanionFile | undefined {
  return [...files].sort((a, b) => {
    const depth = depthOf(a.path) - depthOf(b.path);
    if (depth !== 0) return depth;
    return a.path.localeCompare(b.path);
  })[0];
}

/**
 * Find the companion a glTF or MTL reference names.
 * Exact path, then case-insensitive path, then case-insensitive file name.
 */
export function resolveCompanion(
  ref: string,
  baseDir: string,
  files: readonly CompanionFile[],
): CompanionFile | null {
  const exact = normalizeCompanionPath(ref, baseDir);
  const normalized = files.map((file) => ({ file, path: normalizeCompanionPath(file.path, '') }));
  const direct = normalized.find((item) => item.path === exact);
  if (direct) return direct.file;
  const lower = exact.toLowerCase();
  const insensitive = normalized.find((item) => item.path.toLowerCase() === lower);
  if (insensitive) return insensitive.file;
  const name = baseName(exact).toLowerCase();
  if (!name) return null;
  const byName = normalized.filter((item) => baseName(item.path).toLowerCase() === name).map((item) => item.file);
  return byShallowPath(byName) ?? null;
}

export function missingCompanions(refs: readonly string[], baseDir: string, files: readonly CompanionFile[]): string[] {
  return refs.filter((ref) => resolveCompanion(ref, baseDir, files) == null);
}

/** Folder of the primary file, using its companion path when the selection has one. */
export function companionBaseDir(primary: { name: string; file?: File; companions?: readonly CompanionFile[] }): string {
  const own = primary.companions?.find((item) => item.file === primary.file);
  const path = normalizeCompanionPath(own?.path ?? primary.name, '');
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function externalUri(value: unknown): string | null {
  if (!isRecord(value) || typeof value.uri !== 'string') return null;
  if (value.uri.startsWith('data:')) return null;
  return value.uri;
}

export function gltfRefs(json: unknown): GltfRefs {
  const root = isRecord(json) ? json : {};
  const buffers: string[] = [];
  const images: string[] = [];
  if (Array.isArray(root.buffers)) {
    for (const buffer of root.buffers) {
      const uri = externalUri(buffer);
      if (uri) buffers.push(uri);
    }
  }
  if (Array.isArray(root.images)) {
    for (const image of root.images) {
      if (!isRecord(image) || image.bufferView != null) continue;
      const uri = externalUri(image);
      if (uri) images.push(uri);
    }
  }
  const required = Array.isArray(root.extensionsRequired)
    ? root.extensionsRequired.filter((item): item is string => typeof item === 'string')
    : [];
  return { buffers, images, required };
}

export function objRefs(text: string): string[] {
  const refs: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.toLowerCase().startsWith('mtllib')) continue;
    const parts = line.split(/\s+/).slice(1);
    for (const part of parts) {
      if (part) refs.push(part);
    }
  }
  return refs;
}

const MTL_MAPS = new Set(['map_kd', 'map_ks', 'map_ke', 'map_d', 'map_bump', 'bump', 'norm', 'disp']);

function stripMapOptions(tokens: string[]): string {
  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? '';
    if (!token.startsWith('-')) {
      kept.push(token);
      continue;
    }
    const flag = token.toLowerCase();
    if (flag === '-o' || flag === '-s' || flag === '-t') i += 3;
    else if (flag === '-mm') i += 2;
    else i += 1;
  }
  return kept.join(' ').trim();
}

export function mtlRefs(text: string): string[] {
  const refs: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const tokens = line.split(/\s+/);
    const key = tokens[0]?.toLowerCase();
    if (!key || !MTL_MAPS.has(key)) continue;
    const url = stripMapOptions(tokens.slice(1));
    if (url) refs.push(url);
  }
  return refs;
}
