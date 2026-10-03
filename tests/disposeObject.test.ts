import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { disposeObject3D } from '../src/renderables/disposeObject';
import { MeshRenderable } from '../src/renderables/meshRenderable';

function listen(target: THREE.EventDispatcher, counts: { n: number }): void {
  const dispatcher = target as THREE.EventDispatcher<{ dispose: { type: string } }>;
  dispatcher.addEventListener('dispose', () => {
    counts.n += 1;
  });
}

function scene(): {
  root: THREE.Group;
  texture: THREE.Texture;
  close: ReturnType<typeof vi.fn>;
  geometryDisposes: { n: number };
  materialDisposes: { n: number };
  textureDisposes: { n: number };
} {
  const texture = new THREE.Texture();
  const close = vi.fn();
  texture.image = { close, width: 1, height: 1 };
  const textureDisposes = { n: 0 };
  listen(texture, textureDisposes);

  const geometryDisposes = { n: 0 };
  const materialDisposes = { n: 0 };
  const trackGeometry = (geometry: THREE.BufferGeometry) => {
    listen(geometry, geometryDisposes);
    return geometry;
  };
  const trackMaterial = (material: THREE.Material) => {
    listen(material, materialDisposes);
    return material;
  };

  const positions = new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3);
  const meshGeometry = trackGeometry(new THREE.BufferGeometry());
  meshGeometry.setAttribute('position', positions);
  const shared = () =>
    trackMaterial(
      new THREE.MeshStandardMaterial({
        map: texture,
        normalMap: texture,
      }),
    );
  const mesh = new THREE.Mesh(meshGeometry, [shared(), shared()]);

  const pointsGeometry = trackGeometry(new THREE.BufferGeometry());
  pointsGeometry.setAttribute('position', positions.clone());
  const points = new THREE.Points(pointsGeometry, trackMaterial(new THREE.PointsMaterial({ size: 1 })));

  const bone = new THREE.Bone();
  const skeleton = new THREE.Skeleton([bone]);
  const skinnedGeometry = trackGeometry(new THREE.BufferGeometry());
  skinnedGeometry.setAttribute('position', positions.clone());
  const skinned = new THREE.SkinnedMesh(skinnedGeometry, trackMaterial(new THREE.MeshStandardMaterial()));
  skinned.add(bone);
  skinned.bind(skeleton);

  const uniformTexture = new THREE.Texture();
  uniformTexture.image = { close: vi.fn(), width: 1, height: 1 };
  listen(uniformTexture, textureDisposes);
  const shaderGeometry = trackGeometry(new THREE.BufferGeometry());
  shaderGeometry.setAttribute('position', positions.clone());
  const shader = new THREE.Mesh(
    shaderGeometry,
    trackMaterial(
      new THREE.ShaderMaterial({
        uniforms: { splat: { value: uniformTexture } },
      }),
    ),
  );

  const root = new THREE.Group();
  root.add(mesh, points, skinned, shader);
  return { root, texture, close, geometryDisposes, materialDisposes, textureDisposes };
}

describe('disposeObject3D', () => {
  it('disposes shared textures once and closes image bitmaps', () => {
    const built = scene();
    const counts = disposeObject3D(built.root);
    expect(built.textureDisposes.n).toBe(2);
    expect(built.close).toHaveBeenCalledOnce();
    expect(counts.textures).toBe(2);
    expect(counts.materials).toBe(built.materialDisposes.n);
    expect(counts.geometries).toBe(built.geometryDisposes.n);
    expect(built.materialDisposes.n).toBe(5);
    expect(built.geometryDisposes.n).toBe(4);
  });

  it('matches MeshRenderable.dispose', () => {
    const direct = scene();
    disposeObject3D(direct.root);
    const wrapped = scene();
    const renderable = new MeshRenderable('model', { fileName: 'model.glb', loaderId: 'mesh', loadMs: 0 }, wrapped.root);
    renderable.dispose();
    expect(wrapped.textureDisposes.n).toBe(direct.textureDisposes.n);
    expect(wrapped.materialDisposes.n).toBe(direct.materialDisposes.n);
    expect(wrapped.geometryDisposes.n).toBe(direct.geometryDisposes.n);
    expect(wrapped.close).toHaveBeenCalledOnce();
  });
});
