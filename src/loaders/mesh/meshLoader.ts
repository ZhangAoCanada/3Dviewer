import * as THREE from 'three';
import { raceAbort } from '../../core/abortable';
import {
  companionBaseDir,
  gltfRefs,
  missingCompanions,
  mtlRefs,
  objRefs,
  resolveCompanion,
} from '../../core/fileSet';
import { MissingCompanionsError } from '../../core/loadFailure';
import { sniffMesh } from '../../core/sniff';
import type { AssetSource, CompanionFile, FormatLoader } from '../../core/types';
import { disposeObject3D } from '../../renderables/disposeObject';
import { MeshRenderable } from '../../renderables/meshRenderable';

const LOCAL_ROOT = 'local:/';
const NEUTRAL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNoaGgAAAMEAYFL09IQAAAAAElFTkSuQmCC';
const OBJ_HOLD = 'omniview-obj-hold';
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);
const UNSUPPORTED_GLTF = new Set([
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_meshopt_compression',
  'KHR_texture_basisu',
]);

interface MeshFacts {
  materials: string;
  note?: string;
}

function isLocal(source: AssetSource): boolean {
  return source.file != null || source.bytes != null;
}

async function sourceText(source: AssetSource): Promise<string> {
  if (source.file) return source.file.text();
  if (source.bytes) return new TextDecoder().decode(source.bytes);
  throw new Error(`No data for ${source.name}`);
}

function loadText(url: string, manager: THREE.LoadingManager): Promise<string> {
  const loader = new THREE.FileLoader(manager);
  loader.setResponseType('text');
  return loader.loadAsync(url).then((data) => {
    if (typeof data !== 'string') throw new Error(`Expected text from ${url}`);
    return data;
  });
}

async function readOptionalText(url: string, manager: THREE.LoadingManager, signal: AbortSignal): Promise<string | null> {
  try {
    return await loadText(url, manager);
  } catch (error) {
    if (signal.aborted) throw error;
    return null;
  }
}

function objectUrl(source: AssetSource, blobs: Set<string>): string {
  if (source.file) {
    const url = URL.createObjectURL(source.file);
    blobs.add(url);
    return url;
  }
  if (source.bytes) {
    const type = source.extension === 'obj' ? 'text/plain' : 'model/gltf-binary';
    const url = URL.createObjectURL(new Blob([source.bytes], { type }));
    blobs.add(url);
    return url;
  }
  if (source.url) return source.url;
  throw new Error(`No data for ${source.name}`);
}

function textureNote(missing: readonly string[]): string | undefined {
  if (missing.length === 0) return undefined;
  const noun = missing.length === 1 ? 'texture' : 'textures';
  return `Loaded without ${missing.length} ${noun}: ${missing.join(', ')}.`;
}

function appendNote(facts: MeshFacts, note: string | undefined): void {
  if (!note) return;
  facts.note = facts.note ? `${facts.note} ${note}` : note;
}

function isImageRef(ref: string): boolean {
  const base = ref.split(/[/\\]/).pop() ?? ref;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return IMAGE_EXT.has(base.slice(dot + 1).toLowerCase());
}

function installLocalModifier(
  manager: THREE.LoadingManager,
  baseDir: string,
  files: readonly CompanionFile[],
  blobs: Set<string>,
): void {
  const cache = new Map<string, string>();
  manager.setURLModifier((url) => {
    const cached = cache.get(url);
    if (cached) return cached;
    if (/^(blob:|data:|https?:)/i.test(url)) return url;
    const ref = url.startsWith(LOCAL_ROOT) ? url.slice(LOCAL_ROOT.length) : url;
    const companion = resolveCompanion(ref, baseDir, files);
    let resolved = url;
    if (companion) {
      resolved = URL.createObjectURL(companion.file);
      blobs.add(resolved);
    } else if (isImageRef(ref)) {
      resolved = NEUTRAL_PNG;
    }
    cache.set(url, resolved);
    return resolved;
  });
}

function unsupportedGltf(required: readonly string[]): string | null {
  return required.find((name) => UNSUPPORTED_GLTF.has(name)) ?? null;
}

async function loadLocalGltf(
  source: AssetSource,
  manager: THREE.LoadingManager,
  blobs: Set<string>,
  facts: MeshFacts,
): Promise<THREE.Object3D> {
  const text = await sourceText(source);
  const json: unknown = JSON.parse(text);
  const refs = gltfRefs(json);
  const files = source.companions ?? [];
  const baseDir = companionBaseDir(source);
  const missingBuffers = missingCompanions(refs.buffers, baseDir, files);
  if (missingBuffers.length > 0) {
    const missingImages = missingCompanions(refs.images, baseDir, files);
    throw new MissingCompanionsError([...missingBuffers, ...missingImages]);
  }
  const unsupported = unsupportedGltf(refs.required);
  if (unsupported) {
    throw new Error(
      `This glTF needs ${unsupported}, which Omniview does not decode yet. Export it without compression, or as .glb.`,
    );
  }
  const missingImages = missingCompanions(refs.images, baseDir, files);
  appendNote(facts, textureNote(missingImages));
  facts.materials = 'From file';
  installLocalModifier(manager, baseDir, files, blobs);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader(manager).parseAsync(text, LOCAL_ROOT);
  return gltf.scene;
}

async function readMtl(
  ref: string,
  source: AssetSource,
  url: string,
  manager: THREE.LoadingManager,
  signal: AbortSignal,
): Promise<string | null> {
  if (isLocal(source)) return (await resolveCompanion(ref, companionBaseDir(source), source.companions ?? [])?.file.text()) ?? null;
  const base = THREE.LoaderUtils.extractUrlBase(url);
  let mtlUrl = base + ref;
  try {
    mtlUrl = new URL(ref, base).href;
  } catch {
    /* keep the joined URL */
  }
  return readOptionalText(mtlUrl, manager, signal);
}

async function loadObj(
  source: AssetSource,
  url: string,
  manager: THREE.LoadingManager,
  blobs: Set<string>,
  facts: MeshFacts,
  signal: AbortSignal,
): Promise<THREE.Object3D> {
  const objText = isLocal(source) ? await sourceText(source) : await loadText(url, manager);
  const libraries = objRefs(objText);
  const base = isLocal(source) ? LOCAL_ROOT : THREE.LoaderUtils.extractUrlBase(url);
  const baseDir = companionBaseDir(source);
  const files = source.companions ?? [];
  if (isLocal(source)) installLocalModifier(manager, baseDir, files, blobs);

  const found: { name: string; text: string }[] = [];
  const missing: string[] = [];
  for (const ref of libraries) {
    const text = await readMtl(ref, source, url, manager, signal);
    if (text == null) missing.push(ref);
    else found.push({ name: ref, text });
  }

  const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
  const objLoader = new OBJLoader(manager);
  if (found.length > 0) {
    const { MTLLoader } = await import('three/addons/loaders/MTLLoader.js');
    const materials = new MTLLoader(manager).setResourcePath(base).parse(found.map((item) => item.text).join('\n'), base);
    const missingTextures = isLocal(source)
      ? missingCompanions(
          found.flatMap((item) => mtlRefs(item.text)),
          baseDir,
          files,
        )
      : [];
    materials.preload();
    objLoader.setMaterials(materials);
    facts.materials = `From ${found.map((item) => item.name).join(', ')}`;
    appendNote(facts, textureNote(missingTextures));
    if (missing.length > 0) {
      appendNote(facts, `Materials not found: ${missing.join(', ')}. Showing geometry only.`);
    }
  } else if (missing.length > 0) {
    facts.materials = `Missing ${missing.join(', ')} (geometry only)`;
    appendNote(facts, `Materials not found: ${missing.join(', ')}. Showing geometry only.`);
  } else {
    facts.materials = 'None (geometry only)';
  }
  return objLoader.parse(objText);
}

async function loadRoot(
  extension: string,
  url: string,
  manager: THREE.LoadingManager,
  companions: readonly CompanionFile[] | undefined,
  source: AssetSource,
  blobs: Set<string>,
  facts: MeshFacts,
  signal: AbortSignal,
): Promise<THREE.Object3D> {
  const files = companions ?? source.companions;
  const withFiles = files === source.companions ? source : { ...source, companions: files };
  if (extension === 'obj') return loadObj(withFiles, url, manager, blobs, facts, signal);
  if (extension === 'gltf' && isLocal(withFiles)) return loadLocalGltf(withFiles, manager, blobs, facts);
  facts.materials = 'From file';
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  return (await new GLTFLoader(manager).loadAsync(url)).scene;
}

function ensureMaterials(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const missing = materials.length === 0 || materials.some((material) => material == null);
    if (missing || mesh.material == null) {
      mesh.material = new THREE.MeshStandardMaterial({
        color: '#d5deea',
        metalness: 0.04,
        roughness: 0.62,
        side: THREE.DoubleSide,
      });
    }
  });
}

export const meshLoader: FormatLoader = {
  id: 'mesh-gltf-obj',
  label: 'Mesh',
  extensions: ['glb', 'gltf', 'obj'],
  kind: 'mesh',
  priority: 15,
  sniff: sniffMesh,
  async load(source, ctx) {
    const started = performance.now();
    ctx.onProgress({ loaded: 0, stage: 'parse', message: `Loading ${source.name}` });
    const manager = new THREE.LoadingManager();
    const onAbort = () => manager.abort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });
    const blobs = new Set<string>();
    let revoked = false;
    const revokeAll = () => {
      if (revoked) return;
      revoked = true;
      ctx.signal.removeEventListener('abort', revokeOnAbort);
      for (const url of blobs) URL.revokeObjectURL(url);
      blobs.clear();
    };
    const revokeOnAbort = () => revokeAll();
    const facts: MeshFacts = { materials: 'From file' };
    const deferRevoke = source.extension === 'obj';
    let hold = false;
    let root: THREE.Object3D | undefined;
    const pending = (async () => {
      if (ctx.signal.aborted) manager.abort();
      const embedded = isLocal(source) && (source.extension === 'gltf' || source.extension === 'obj');
      const url = embedded ? '' : objectUrl(source, blobs);
      return loadRoot(source.extension, url, manager, source.companions, source, blobs, facts, ctx.signal);
    })();
    void pending.catch(() => {
      if (ctx.signal.aborted) revokeAll();
    });
    try {
      if (deferRevoke) {
        manager.itemStart(OBJ_HOLD);
        hold = true;
      }
      root = await raceAbort(pending, ctx.signal, (late) => {
        disposeObject3D(late);
        revokeAll();
      });
      ensureMaterials(root);
      ctx.onProgress({ loaded: 1, total: 1, stage: 'ready', message: source.name });
      const renderable = new MeshRenderable(
        source.name,
        {
          fileName: source.name,
          loaderId: meshLoader.id,
          loadMs: performance.now() - started,
          bytes: source.sizeBytes ?? source.file?.size,
        },
        root,
        { materials: facts.materials, note: facts.note },
      );
      root = undefined;
      if (deferRevoke) {
        ctx.signal.addEventListener('abort', revokeOnAbort, { once: true });
        const prior = manager.onLoad;
        manager.onLoad = () => {
          if (typeof prior === 'function') prior();
          revokeAll();
        };
        manager.itemEnd(OBJ_HOLD);
        hold = false;
      } else {
        revokeAll();
      }
      return renderable;
    } catch (error) {
      if (root) disposeObject3D(root);
      if (!ctx.signal.aborted) revokeAll();
      throw error;
    } finally {
      if (hold) manager.itemEnd(OBJ_HOLD);
      ctx.signal.removeEventListener('abort', onAbort);
    }
  },
};
