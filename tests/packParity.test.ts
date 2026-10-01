import { ExtSplats, PackedSplats, utils } from '@sparkjsdev/spark';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  DEFAULT_LIMITS,
  writeExtSplat,
  writeExtSh1,
  writeExtSh2,
  writeExtSh3,
  writePackedSplat,
  writePackedSh1,
  writePackedSh2,
  writePackedSh3,
} from '../src/loaders/gaussian/packSplat';

const COUNT = 200;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function words(array: ArrayLike<number>, length: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i += 1) out.push((array[i] ?? 0) >>> 0);
  return out;
}

describe('packed splat parity with Spark 2.2.0', () => {
  it('matches PackedSplats.setSplat and the SH / extended encoders', () => {
    const rand = mulberry32(0x5b82);
    const encoding = { ...DEFAULT_LIMITS };
    const packed = new PackedSplats({ maxSplats: COUNT, splatEncoding: encoding });
    const ext = new ExtSplats({ maxSplats: COUNT });
    const ours = new Uint32Array(COUNT * 4);
    const sh1 = new Uint32Array(COUNT * 2);
    const sh2 = new Uint32Array(COUNT * 4);
    const sh3 = new Uint32Array(COUNT * 4);
    const sparkSh1 = new Uint32Array(COUNT * 2);
    const sparkSh2 = new Uint32Array(COUNT * 4);
    const sparkSh3 = new Uint32Array(COUNT * 4);
    const extA = new Uint32Array(COUNT * 4);
    const extB = new Uint32Array(COUNT * 4);
    const extSh1 = new Uint32Array(COUNT * 4);
    const extSh2 = new Uint32Array(COUNT * 4);
    const extSh3a = new Uint32Array(COUNT * 4);
    const extSh3b = new Uint32Array(COUNT * 4);
    const sparkExtSh1 = new Uint32Array(COUNT * 4);
    const sparkExtSh2 = new Uint32Array(COUNT * 4);
    const sparkExtSh3a = new Uint32Array(COUNT * 4);
    const sparkExtSh3b = new Uint32Array(COUNT * 4);

    for (let i = 0; i < COUNT; i += 1) {
      const x = (rand() * 2 - 1) * 500;
      const y = (rand() * 2 - 1) * 500;
      const z = (rand() * 2 - 1) * 500;
      const scaleX = 1e-4 * (50 / 1e-4) ** rand();
      const scaleY = 1e-4 * (50 / 1e-4) ** rand();
      const scaleZ = 1e-4 * (50 / 1e-4) ** rand();
      let qx = rand() * 2 - 1;
      let qy = rand() * 2 - 1;
      let qz = rand() * 2 - 1;
      let qw = rand() * 2 - 1;
      const qlen = Math.hypot(qx, qy, qz, qw) || 1;
      qx /= qlen;
      qy /= qlen;
      qz /= qlen;
      qw /= qlen;
      const opacity = rand();
      const r = rand();
      const g = rand();
      const b = rand();
      const sh1Rgb = Float32Array.from({ length: 9 }, () => rand() * 4 - 2);
      const sh2Rgb = Float32Array.from({ length: 15 }, () => rand() * 4 - 2);
      const sh3Rgb = Float32Array.from({ length: 21 }, () => rand() * 4 - 2);

      writePackedSplat(ours, i, x, y, z, scaleX, scaleY, scaleZ, qx, qy, qz, qw, opacity, r, g, b, encoding);
      packed.setSplat(
        i,
        new THREE.Vector3(x, y, z),
        new THREE.Vector3(scaleX, scaleY, scaleZ),
        new THREE.Quaternion(qx, qy, qz, qw),
        opacity,
        new THREE.Color(r, g, b),
      );
      writePackedSh1(sh1, i, sh1Rgb, encoding.sh1Max);
      writePackedSh2(sh2, i, sh2Rgb, encoding.sh2Max);
      writePackedSh3(sh3, i, sh3Rgb, encoding.sh3Max);
      utils.encodeSh1Rgb(sparkSh1, i, sh1Rgb, encoding);
      utils.encodeSh2Rgb(sparkSh2, i, sh2Rgb, encoding);
      utils.encodeSh3Rgb(sparkSh3, i, sh3Rgb, encoding);

      writeExtSplat(extA, extB, i, x, y, z, scaleX, scaleY, scaleZ, qx, qy, qz, qw, opacity, r, g, b);
      ext.setSplat(
        i,
        new THREE.Vector3(x, y, z),
        new THREE.Vector3(scaleX, scaleY, scaleZ),
        new THREE.Quaternion(qx, qy, qz, qw),
        opacity,
        new THREE.Color(r, g, b),
      );
      writeExtSh1(extSh1, i, sh1Rgb);
      writeExtSh2(extSh1, extSh2, i, sh1Rgb, sh2Rgb);
      writeExtSh3(extSh3a, extSh3b, i, sh3Rgb);
      utils.encodeExtSh1Rgb(sparkExtSh1, i, sh1Rgb);
      utils.encodeExtSh12Rgb(sparkExtSh1, sparkExtSh2, i, sh1Rgb, sh2Rgb);
      utils.encodeExt3Rgb(sparkExtSh3a, sparkExtSh3b, i, sh3Rgb);
      // encodeExtSh12Rgb in Spark 2.2.0 steps the rest of SH2 by k * 5, but the
      // shader reads those words as consecutive RGB triples. Lock writeExtSh2 to
      // that shader layout via Spark's encodeExtRgb.
      for (let k = 1; k < 5; k += 1) {
        const k3 = k * 3;
        expect(extSh2[i * 4 + (k - 1)]).toBe(
          utils.encodeExtRgb(sh2Rgb[k3] ?? 0, sh2Rgb[k3 + 1] ?? 0, sh2Rgb[k3 + 2] ?? 0),
        );
      }
    }

    const sparkPacked = packed.packedArray;
    expect(sparkPacked).toBeTruthy();
    expect(words(ours, COUNT * 4)).toEqual(words(sparkPacked!, COUNT * 4));
    expect(words(sh1, sh1.length)).toEqual(words(sparkSh1, sparkSh1.length));
    expect(words(sh2, sh2.length)).toEqual(words(sparkSh2, sparkSh2.length));
    expect(words(sh3, sh3.length)).toEqual(words(sparkSh3, sparkSh3.length));
    expect(words(extA, COUNT * 4)).toEqual(words(ext.extArrays[0]!, COUNT * 4));
    expect(words(extB, COUNT * 4)).toEqual(words(ext.extArrays[1]!, COUNT * 4));
    expect(words(extSh1, extSh1.length)).toEqual(words(sparkExtSh1, sparkExtSh1.length));
    expect(words(extSh3a, extSh3a.length)).toEqual(words(sparkExtSh3a, sparkExtSh3a.length));
    expect(words(extSh3b, extSh3b.length)).toEqual(words(sparkExtSh3b, sparkExtSh3b.length));
  });
});
