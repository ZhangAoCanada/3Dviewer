import { describe, expect, it } from 'vitest';
import {
  gltfRefs,
  missingCompanions,
  mtlRefs,
  objRefs,
  pickPrimary,
  resolveCompanion,
} from '../src/core/fileSet';
import type { CompanionFile } from '../src/core/types';

function companion(path: string): CompanionFile {
  const name = path.split('/').pop() ?? path;
  return { path, file: new File(['x'], name) };
}

describe('pickPrimary', () => {
  it('prefers glb over every other scene type and lists the rest as ignored', () => {
    const order = ['zip', 'ply', 'splat', 'ksplat', 'sog', 'spz', 'rad', 'obj', 'gltf', 'glb'];
    const files = order.map((ext) => companion(`f.${ext}`));
    const png = companion('tex.png');
    const picked = pickPrimary([...files, png]);
    expect(picked?.primary.path).toBe('f.glb');
    expect(picked?.ignored).toEqual([
      'f.gltf',
      'f.obj',
      'f.rad',
      'f.spz',
      'f.sog',
      'f.ksplat',
      'f.splat',
      'f.ply',
      'f.zip',
    ]);
    expect(picked?.companions).toEqual([png]);
  });

  it('breaks ties by the shallowest path, then the name', () => {
    const nested = companion('dir/b.glb');
    const shallowB = companion('b.glb');
    const shallowA = companion('a.glb');
    const picked = pickPrimary([nested, shallowB, shallowA]);
    expect(picked?.primary.path).toBe('a.glb');
    expect(picked?.ignored).toEqual(['b.glb', 'b.glb']);
  });

  it('returns null when nothing is a scene file', () => {
    expect(pickPrimary([companion('tex.png'), companion('scene.bin')])).toBeNull();
  });
});

describe('resolveCompanion', () => {
  const files = [
    companion('a.bin'),
    companion('textures dir/a.png'),
    companion('tex/A.PNG'),
    companion('folder/a.jpg'),
    companion('deep/folder/a.jpg'),
  ];

  it('drops ./, decodes escapes, resolves .., and falls back to the file name', () => {
    expect(resolveCompanion('./a.bin', '', files)?.path).toBe('a.bin');
    expect(resolveCompanion('textures%20dir/a.png', '', files)?.path).toBe('textures dir/a.png');
    expect(resolveCompanion('..\\tex\\A.PNG', 'models', files)?.path).toBe('tex/A.PNG');
    expect(resolveCompanion('C:\\abs\\a.jpg', '', files)?.path).toBe('folder/a.jpg');
  });
});

describe('gltfRefs', () => {
  it('skips data URIs and bufferView images and returns required extensions', () => {
    const refs = gltfRefs({
      buffers: [{ uri: 'scene.bin' }, { uri: 'data:application/octet-stream,abc' }, {}],
      images: [{ uri: 'tex.png' }, { uri: 'data:image/png;base64,aaaa' }, { bufferView: 0, mimeType: 'image/png' }],
      extensionsRequired: ['KHR_draco_mesh_compression'],
    });
    expect(refs.buffers).toEqual(['scene.bin']);
    expect(refs.images).toEqual(['tex.png']);
    expect(refs.required).toEqual(['KHR_draco_mesh_compression']);
  });
});

describe('obj and mtl refs', () => {
  it('reads every mtllib name', () => {
    expect(objRefs('mtllib a.mtl\n# note\nmtllib b.mtl c.mtl\n')).toEqual(['a.mtl', 'b.mtl', 'c.mtl']);
  });

  it('skips map options such as -bm 0.5', () => {
    const text = ['newmtl mat', 'map_Kd wood.png', 'map_Bump -bm 0.5 normal.png', 'map_Ks -s 1 1 1 spec.png', 'disp -bm 0.2 height.png'].join(
      '\n',
    );
    expect(mtlRefs(text)).toEqual(['wood.png', 'normal.png', 'spec.png', 'height.png']);
  });
});

describe('missingCompanions', () => {
  it('lists references that do not resolve', () => {
    const files = [companion('scene.bin')];
    expect(missingCompanions(['./scene.bin', 'textures/wood.png'], '', files)).toEqual(['textures/wood.png']);
  });
});
