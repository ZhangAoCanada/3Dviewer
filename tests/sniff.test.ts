import { describe, expect, it } from 'vitest';
import { classifyPly, extensionOf, headerText, isGlbMagic, sniffGaussian, sniffPoints } from '../src/core/sniff';
import type { AssetSource } from '../src/core/types';

const gaussianHeader = `ply
format binary_little_endian 1.0
element vertex 2
property float x
property float y
property float z
property float f_dc_0
property float opacity
property float scale_0
end_header
`;

const pointHeader = `ply
format binary_little_endian 1.0
element vertex 2
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
`;

function source(name: string): AssetSource {
  return { name, extension: extensionOf(name), origin: 'file' };
}

describe('format sniffing', () => {
  it('reads extensions without query strings', () => {
    expect(extensionOf('folder/scene.ply?download=1')).toBe('ply');
    expect(extensionOf('noext')).toBe('');
  });

  it('classifies gaussian and point-cloud ply headers', () => {
    expect(classifyPly(gaussianHeader)).toBe('gaussian');
    expect(classifyPly(pointHeader)).toBe('points');
    expect(classifyPly('not a ply')).toBe('not-ply');
    expect(classifyPly('ply\nelement chunk\nproperty float min_x\nend_header')).toBe('gaussian');
  });

  it('lets gaussian and point loaders share .ply without overlap', () => {
    const gBytes = new TextEncoder().encode(gaussianHeader);
    const pBytes = new TextEncoder().encode(pointHeader);
    expect(sniffGaussian(source('scene.ply'), gBytes)).toBe(true);
    expect(sniffPoints(source('scene.ply'), gBytes)).toBe(false);
    expect(sniffGaussian(source('cloud.ply'), pBytes)).toBe(false);
    expect(sniffPoints(source('cloud.ply'), pBytes)).toBe(true);
    expect(sniffGaussian(source('bug.splat'), new Uint8Array())).toBe(true);
    expect(headerText(gBytes).includes('end_header')).toBe(true);
  });

  it('recognizes glb magic', () => {
    expect(isGlbMagic(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]))).toBe(true);
    expect(isGlbMagic(new Uint8Array([1, 2, 3, 4]))).toBe(false);
  });
});
