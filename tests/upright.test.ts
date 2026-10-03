import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { isFlatScene } from '../src/render/cameraMotion';
import {
  FLIP_Y,
  fitPlane,
  levelRotation,
  orientationLabel,
  patchRadius,
  quarterTurn,
  readUpright,
  robustBox,
  rotationAngle,
  snapOrientation,
  uprightKey,
  writeUpright,
  type UprightStorage,
} from '../src/render/upright';

function memoryStorage(): UprightStorage & { raw: () => string | null } {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next;
    },
    raw: () => value,
  };
}

describe('fitPlane', () => {
  it('recovers a plane tilted 7° with ±1% noise to within 0.5°', () => {
    const tilt = (7 * Math.PI) / 180;
    const points = new Float32Array(80 * 3);
    let offset = 0;
    for (let i = 0; i < 8; i += 1) {
      for (let j = 0; j < 10; j += 1) {
        const x = (i - 3.5) * 0.25;
        const y = (j - 4.5) * 0.25;
        const y2 = y * Math.cos(tilt);
        const z2 = y * Math.sin(tilt);
        const noise = (((i * 17 + j * 3) % 5) - 2) / 2;
        const extent = 2;
        points[offset] = x;
        points[offset + 1] = y2;
        points[offset + 2] = z2 + noise * 0.01 * extent;
        offset += 3;
      }
    }
    const fit = fitPlane(points);
    expect(fit).not.toBeNull();
    const expected = new THREE.Vector3(0, -Math.sin(tilt), Math.cos(tilt)).normalize();
    const normal = fit?.normal.clone().normalize() ?? new THREE.Vector3();
    if (normal.dot(expected) < 0) normal.negate();
    const angle = Math.acos(THREE.MathUtils.clamp(normal.dot(expected), -1, 1));
    expect((angle * 180) / Math.PI).toBeLessThan(0.5);
  });

  it('returns null for collinear points and for fewer than 8 points', () => {
    const few = new Float32Array(7 * 3);
    for (let i = 0; i < 7; i += 1) {
      few[i * 3] = i;
      few[i * 3 + 1] = i * 0.2;
      few[i * 3 + 2] = 1;
    }
    expect(fitPlane(few)).toBeNull();

    const line = new Float32Array(12 * 3);
    for (let i = 0; i < 12; i += 1) {
      line[i * 3] = i;
      line[i * 3 + 1] = i * 2;
      line[i * 3 + 2] = -i;
    }
    expect(fitPlane(line)).toBeNull();
  });

  it('follows towardCamera when choosing the normal sign', () => {
    const normal = new THREE.Vector3(0, -0.2, 0.98).normalize();
    const up = new THREE.Vector3(0, 0, 1);
    const toward = new THREE.Vector3(0, -0.1, 1);
    const away = toward.clone().negate();
    const facing = levelRotation(normal, toward, up);
    const opposite = levelRotation(normal, away, up);
    const mapped = normal.clone().applyQuaternion(facing);
    const flipped = normal.clone().applyQuaternion(opposite);
    expect(mapped.dot(flipped)).toBeLessThan(-0.999);
  });
});

describe('levelRotation', () => {
  it('maps the camera-facing normal to up within 1e-9', () => {
    const normal = new THREE.Vector3(0.1, -0.3, 0.8);
    const toward = new THREE.Vector3(-2, 0.4, 5);
    const up = new THREE.Vector3(0, 1, 0);
    const rotation = levelRotation(normal, toward, up);
    const facing = normal.clone().normalize();
    if (facing.dot(toward) < 0) facing.negate();
    facing.applyQuaternion(rotation);
    expect(facing.distanceTo(up.clone().normalize())).toBeLessThan(1e-9);
  });
});

describe('quarterTurn', () => {
  it('returns the identity after four snaps about X', () => {
    let q = new THREE.Quaternion();
    const turn = quarterTurn('x', 1);
    for (let i = 0; i < 4; i += 1) q = snapOrientation(turn.clone().multiply(q));
    expect(orientationLabel(q)).toBe('As in file');
    expect(Math.hypot(q.x, q.y, q.z)).toBeLessThan(1e-8);
    expect(Math.abs(Math.abs(q.w) - 1)).toBeLessThan(1e-8);
  });

  it('composes with the file flip back to the file orientation', () => {
    let q = FLIP_Y.clone();
    const turn = quarterTurn('x', 1);
    for (let i = 0; i < 4; i += 1) q = snapOrientation(turn.clone().multiply(q));
    const relative = snapOrientation(q.clone().multiply(FLIP_Y.clone().invert()));
    expect(orientationLabel(relative)).toBe('As in file');
  });
});

describe('robustBox', () => {
  it('ignores 1% outliers', () => {
    const count = 100;
    const points = new Float32Array((count + 1) * 3);
    for (let i = 0; i < count; i += 1) {
      points[i * 3] = i;
      points[i * 3 + 1] = i / 10;
      points[i * 3 + 2] = 5;
    }
    points[count * 3] = 10_000;
    points[count * 3 + 1] = -10_000;
    points[count * 3 + 2] = 10_000;
    const box = robustBox(points);
    expect(box.max.x).toBeLessThan(100);
    expect(box.min.y).toBeGreaterThan(-1);
    expect(box.max.z).toBeLessThan(20);
  });
});

describe('upright storage', () => {
  it('round-trips an entry and evicts the oldest past 32', () => {
    const storage = memoryStorage();
    writeUpright(storage, 'scan.ply|12', { q: [0, 0, 0, 1], up: 'z', at: 10 });
    expect(readUpright(storage)['scan.ply|12']).toEqual({ q: [0, 0, 0, 1], up: 'z', at: 10 });
    for (let i = 0; i < 33; i += 1) {
      writeUpright(storage, `k${i}`, { q: [0, 0, 0, 1], up: 'y', at: 100 + i });
    }
    const map = readUpright(storage);
    expect(map.k0).toBeUndefined();
    expect(map['scan.ply|12']).toBeUndefined();
    expect(Object.keys(map)).toHaveLength(32);
    expect(map.k32?.at).toBe(132);
    writeUpright(storage, 'k32', null);
    expect(readUpright(storage).k32).toBeUndefined();
  });

  it('keys a file by name and size, and a remote source by URL', () => {
    expect(uprightKey({ origin: 'file', name: 'scan.ply', sizeBytes: 42 })).toBe('scan.ply|42');
    expect(uprightKey({ origin: 'url', name: 'scan.ply', url: 'https://example.com/scan.ply?x=1' })).toBe(
      'https://example.com/scan.ply?x=1',
    );
    expect(uprightKey({ origin: 'sample', name: 'torus.ply', url: '/3Dviewer/samples/torus.ply' })).toBe(
      '/3Dviewer/samples/torus.ply',
    );
  });
});

describe('orientationLabel', () => {
  it('names the file orientation and a quarter turn', () => {
    expect(orientationLabel(new THREE.Quaternion())).toBe('As in file');
    expect(orientationLabel(quarterTurn('y', -1))).toBe('Turned 90° from file');
    expect(orientationLabel(quarterTurn('z', 1).multiply(quarterTurn('z', 1)))).toBe('Turned 180° from file');
  });
});

describe('leveled slab', () => {
  it('keeps a 590 × 490 × 77 m slab flat after a 10° tilt is removed', () => {
    const tilt = (10 * Math.PI) / 180;
    const coords: number[] = [];
    for (let x = 0; x <= 590; x += 10) {
      for (let y = 0; y <= 490; y += 10) {
        const px = x - 295;
        const py = y - 245;
        const pz = ((x + y) % 17) - 8;
        const x2 = px * Math.cos(tilt) + pz * Math.sin(tilt);
        const z2 = -px * Math.sin(tilt) + pz * Math.cos(tilt);
        coords.push(x2, py, z2);
      }
    }
    const tilted = Float32Array.from(coords);
    const fit = fitPlane(tilted);
    expect(fit).not.toBeNull();
    const toward = new THREE.Vector3(0, 0, 1);
    const up = new THREE.Vector3(0, 0, 1);
    const rotation = levelRotation(fit?.normal ?? up, toward, up);
    const leveled = new Float32Array(tilted.length);
    const point = new THREE.Vector3();
    for (let i = 0; i < tilted.length; i += 3) {
      point.set(tilted[i] ?? 0, tilted[i + 1] ?? 0, tilted[i + 2] ?? 0).applyQuaternion(rotation);
      leveled[i] = point.x;
      leveled[i + 1] = point.y;
      leveled[i + 2] = point.z;
    }
    const box = robustBox(leveled);
    const size = box.getSize(new THREE.Vector3());
    expect(isFlatScene(size, 'z')).toBe(true);
    expect(rotationAngle(rotation)).toBeGreaterThan((5 * Math.PI) / 180);
    expect(patchRadius(tilted)).toBeGreaterThan(100);
  });
});
