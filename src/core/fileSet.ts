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
  const insensitive = normalized.filter((item) => item.path.toLowerCase() === lower);
  if (insensitive.length) return insensitive.length === 1 ? insensitive[0].file : null;
  const name = baseName(exact).toLowerCase();
  if (!name) return null;
  const byName = normalized.filter((item) => baseName(item.path).toLowerCase() === name).map((item) => item.file);
  return byName.length === 1 ? byName[0] : null;
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

/** Reference subset: quoted names, inline comments and common numeric map options. */
function refTokens(text: string): string[] {
  const tokens: string[] = [];
  let token = ''; let quote = '';
  for (const char of text) {
    if (quote) { if (char === quote) quote = ''; else token += char; }
    else if (char === '"' || char === "'") quote = char;
    else if (char === '#') break;
    else if (/\s/.test(char)) { if (token) tokens.push(token); token = ''; }
    else token += char;
  }
  if (quote) throw new Error('Unclosed quote in OBJ/MTL reference');
  if (token) tokens.push(token);
  return tokens;
}

export function objRefs(text: string): string[] {
  const refs: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!/^\s*mtllib\s/i.test(raw)) continue;
    const value = raw.trim().replace(/^mtllib\s+/i, '');
    const tokens = refTokens(value);
    if (!/["']/.test(value) && tokens.length > 1 && tokens.filter((t) => /\.mtl$/i.test(t)).length === 1 && /\.mtl$/i.test(tokens[tokens.length - 1])) refs.push(tokens.join(' '));
    else if (tokens.length > 1 && !/["']/.test(value) && !tokens.every((t) => /\.mtl$/i.test(t))) throw new Error('Ambiguous mtllib names; quote names containing spaces');
    else refs.push(...tokens);
  }
  return refs;
}

const MTL_MAPS = new Set(['map_kd', 'map_ks', 'map_ke', 'map_d', 'map_bump', 'bump', 'norm', 'disp']);

function mapReference(tokens: string[]): { ref: string; value: string } {
  const normalized: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (tokens[i]?.startsWith('-')) {
    const flag = tokens[i++].toLowerCase();
    if (seen.has(flag)) throw new Error(`Duplicate MTL option ${flag}`);
    seen.add(flag);
    const max = flag === '-s' || flag === '-o' ? 3 : flag === '-bm' ? 1 : flag === '-mm' ? 2 : 0;
    if (!max) throw new Error(`Unsupported MTL map option ${flag}; supported: -s, -o, -bm, -mm`);
    const values: number[] = [];
    while (values.length < max && tokens[i] !== undefined && tokens[i].trim() !== '' && Number.isFinite(Number(tokens[i]))) values.push(Number(tokens[i++]));
    const min = flag === '-mm' ? 2 : 1;
    if (values.length < min) throw new Error(`Invalid MTL map option ${flag}`);
    if (flag === '-s' || flag === '-o') while (values.length < 3) values.push(flag === '-s' ? 1 : 0);
    normalized.push(flag, ...values.map(String));
  }
  const ref = tokens.slice(i).join(' ');
  if (!ref || ref.startsWith('-')) throw new Error('MTL texture filename is missing or ambiguous');
  return { ref, value: [...normalized, ref].join(' ') };
}

export function normalizeMtl(text: string): string {
  return text.split(/\r?\n/).map((line) => {
    const tokens = refTokens(line); const key = tokens.shift()?.toLowerCase();
    if (!key) return '';
    return MTL_MAPS.has(key) ? `${key} ${mapReference(tokens).value}` : [key, ...tokens].join(' ');
  }).join('\n');
}

export function mtlRefs(text: string): string[] {
  const refs: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const tokens = refTokens(raw); const key = tokens.shift()?.toLowerCase();
    if (key && MTL_MAPS.has(key)) refs.push(mapReference(tokens).ref);
  }
  return refs;
}
