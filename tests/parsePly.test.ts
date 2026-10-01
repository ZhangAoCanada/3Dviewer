import { describe, expect, it } from 'vitest';
import { parsePlyPoints } from '../src/loaders/points/parsePly';

function asciiPly(): Blob {
  const text = `ply
format ascii 1.0
element vertex 4
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
0 0 0 255 0 0
1 0 0 0 255 0
0 1 0 0 0 255
0 0 1 10 20 30
`;
  return new Blob([text]);
}

function binaryPly(): Blob {
  const header = `ply
format binary_little_endian 1.0
element vertex 5
property float x
property float y
property float z
end_header
`;
  const body = Buffer.alloc(5 * 12);
  const view = new DataView(body.buffer);
  for (let i = 0; i < 5; i++) {
    view.setFloat32(i * 12, i, true);
    view.setFloat32(i * 12 + 4, i + 0.5, true);
    view.setFloat32(i * 12 + 8, -i, true);
  }
  return new Blob([Buffer.concat([Buffer.from(header), body])]);
}

describe('parsePlyPoints', () => {
  it('parses ascii xyzrgb', async () => {
    const data = await parsePlyPoints(asciiPly(), 100);
    expect(data.count).toBe(4);
    expect(data.sourceCount).toBe(4);
    expect(data.stride).toBe(1);
    expect(data.positions[3]).toBe(1);
    expect(data.colors?.[0]).toBeCloseTo(1);
    expect(data.colors?.[4]).toBeCloseTo(1);
  });

  it('subsamples binary ply down to the memory budget', async () => {
    const data = await parsePlyPoints(binaryPly(), 2);
    expect(data.sourceCount).toBe(5);
    expect(data.stride).toBe(3);
    expect(data.count).toBe(2);
    expect(data.positions[0]).toBeCloseTo(0);
    expect(data.positions[3]).toBeCloseTo(3);
    expect(data.colors).toBeNull();
  });

  it('reports progress through the vertex count', async () => {
    const seen: number[] = [];
    const data = await parsePlyPoints(binaryPly(), 100, (loaded, total) => {
      expect(total).toBe(5);
      seen.push(loaded);
    });
    expect(data.count).toBe(5);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(5);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1] ?? -1);
    }
  });
});
