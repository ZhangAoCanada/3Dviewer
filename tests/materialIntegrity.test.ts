import { expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { MeshRenderable } from '../src/renderables/meshRenderable';
import { DEFAULT_SETTINGS } from '../src/core/types';
import { mtlRefs, objRefs, resolveCompanion } from '../src/core/fileSet';

it('Unlit preserves material groups, cutouts, alpha, vertex colors and shared texture ownership', () => {
  const map = new THREE.Texture(); const alphaMap = new THREE.Texture();
  const a = new THREE.MeshStandardMaterial({ color: 'red', map, alphaMap, alphaTest: 0.4, transparent: true, opacity: 0.6, vertexColors: true });
  const b = new THREE.MeshStandardMaterial({ color: 'blue', side: THREE.FrontSide });
  const geometry = new THREE.BoxGeometry(); geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3).fill(1), 3));
  const mesh: THREE.Mesh = new THREE.Mesh(geometry, [a, b]);
  const item = new MeshRenderable('box', { fileName: 'box', loaderId: 'mesh', loadMs: 0 }, mesh);
  item.applySettings({ ...DEFAULT_SETTINGS, shading: 'flat' });
  expect(Array.isArray(mesh.material)).toBe(true);
  const generated = mesh.material as THREE.MeshBasicMaterial[];
  expect(generated.map((m) => m.color.getHexString())).toEqual(['ff0000', '0000ff']);
  expect(generated[0]).toMatchObject({ map, alphaMap, alphaTest: 0.4, transparent: true, opacity: 0.6, vertexColors: true });
  expect(generated[1].side).toBe(THREE.FrontSide);
  const dispose = vi.spyOn(generated[0], 'dispose'); const textureDispose = vi.spyOn(map, 'dispose');
  item.applySettings({ ...DEFAULT_SETTINGS, shading: 'normals' }); expect(dispose).toHaveBeenCalledTimes(1); expect(textureDispose).not.toHaveBeenCalled();
  item.applySettings(DEFAULT_SETTINGS); expect(a.color.getHexString()).toBe('ff0000');
  item.dispose(); expect(textureDispose).toHaveBeenCalledTimes(1);
});
it('reports late image changes so the idle host repaints without camera input', () => {
  const map = new THREE.Texture(); const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial({ map }));
  const item = new MeshRenderable('box', { fileName: 'box', loaderId: 'mesh', loadMs: 0 }, mesh);
  item.update(); map.needsUpdate = true;
  expect(item.update()).toBe(true); expect(Boolean(item.update())).toBe(false); item.dispose();
});
it('supports quoted/spaced libraries and ignores inline comments', () => {
  expect(objRefs('mtllib my materials.mtl # exporter\nmtllib "a one.mtl" b.mtl')).toEqual(['my materials.mtl', 'a one.mtl', 'b.mtl']);
  expect(mtlRefs('map_Kd -s 1 -o 0.5 0 "albedo one.png" # note')).toEqual(['albedo one.png']);
});
it('rejects unsupported ambiguous options instead of requesting a wrong file', () => {
  expect(() => mtlRefs('map_Kd -nonsense 1 tex.png')).toThrow(/unsupported/i);
});
it('does not guess a texture from duplicate basenames', () => {
  const files = ['a/tex.png', 'b/tex.png'].map((path) => ({ path, file: new File([''], 'tex.png') }));
  expect(resolveCompanion('tex.png', 'missing', files)).toBeNull();
  expect(resolveCompanion('tex.png', 'b', files)?.path).toBe('b/tex.png');
});
it('does not guess between case-insensitive duplicate paths', () => {
  const files = ['A/Tex.png', 'a/tex.PNG'].map((path) => ({ path, file: new File([''], 'tex.png') }));
  expect(resolveCompanion('tex.png', 'a', files)).toBeNull();
});
