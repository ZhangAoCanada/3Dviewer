import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MeshRenderable } from '../src/renderables/meshRenderable';

describe('MeshRenderable normals', () => {
  it('keeps an authored normal attribute', () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
    const authored = new Float32Array([0, 0, 1, 0, 1, 0, 1, 0, 0]);
    geometry.setAttribute('normal', new THREE.BufferAttribute(authored, 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
    new MeshRenderable('crate', { fileName: 'crate.glb', loaderId: 'mesh', loadMs: 0 }, mesh);
    const normal = geometry.getAttribute('normal');
    expect(normal.array).toBe(authored);
    expect(Array.from(normal.array as Float32Array)).toEqual(Array.from(authored));
  });
});
