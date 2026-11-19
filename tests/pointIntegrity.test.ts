import { describe, expect, it } from 'vitest';
import { blobSource } from '../src/core/byteSource';
import { classifyPly } from '../src/core/sniff';
import { parsePlyPoints, PlyParseError } from '../src/loaders/points/parsePly';
import { presetConsequence } from '../src/ui/presetConsequence';

function header(count: number | string, format = 'ascii', preamble = ''): string {
  return `ply\nformat ${format} 1.0\n${preamble}element vertex ${count}\nproperty float x\nproperty float y\nproperty float z\nend_header\n`;
}
const parse = (text: string, cap = 100) => parsePlyPoints(blobSource(new Blob([text])), cap);

describe('point data integrity', () => {
  it.each(['0 0 0\n', '0 0\n1 2 3\n', '0 0 0\nNaN 1 2\n', '0 0 0\nInfinity 1 2\n'])('rejects incomplete/nonfinite ASCII: %s', async (body) => {
    await expect(parse(header(2) + body, 1)).rejects.toBeInstanceOf(PlyParseError);
  });
  it.each([-1, 0, 'NaN', '9007199254740992'])('rejects invalid counts %s before allocation', async (count) => {
    await expect(parse(header(count))).rejects.toBeInstanceOf(PlyParseError);
  });
  it('skips declared scalar records before ASCII vertices', async () => {
    const data = await parse(header(2, 'ascii', 'element camera 1\nproperty int id\n') + '42\n1 2 3\n4 6 8');
    expect(Array.from(data.positions)).toEqual([0, 0, 0, 3, 4, 5]);
    expect(data.origin).toEqual([1, 2, 3]);
  });
  it.each(['ascii', 'binary_little_endian', 'binary_big_endian'])('rejects unsupported pre-vertex lists clearly: %s', async (format) => {
    await expect(parse(header(1, format, 'element face 1\nproperty list uchar int vertices\n') + '0\n0 0 0')).rejects.toThrow(/list.*before/i);
  });
  it.each([true, false])('validates endian, short records, and unsampled vertices (little=%s)', async (little) => {
    const h = header(2, little ? 'binary_little_endian' : 'binary_big_endian');
    const bytes = new Uint8Array(24); const v = new DataView(bytes.buffer);
    for (let i = 0; i < 6; i += 1) v.setFloat32(i * 4, i, little);
    const good = await parsePlyPoints(blobSource(new Blob([h, bytes])), 1);
    expect(good.count).toBe(1); expect(good.sourceCount).toBe(2);
    await expect(parsePlyPoints(blobSource(new Blob([h, bytes.slice(0, -1)])), 1)).rejects.toBeInstanceOf(PlyParseError);
    v.setFloat32(12, NaN, little);
    await expect(parsePlyPoints(blobSource(new Blob([h, bytes])), 1)).rejects.toBeInstanceOf(PlyParseError);
  });
  it('streams a large valid source with bounded reads and tiny retained output', async () => {
    const h = new TextEncoder().encode(header(1_000_000, 'binary_little_endian'));
    let biggest = 0;
    const source = { size: h.length + 12_000_000, async read(start: number, end: number) {
      biggest = Math.max(biggest, end - start);
      const b = new Uint8Array(end - start);
      if (start < h.length) b.set(h.subarray(start, Math.min(end, h.length)));
      return b.buffer;
    } };
    const data = await parsePlyPoints(source, 2);
    expect(data.count).toBe(2); expect(data.sourceCount).toBe(1_000_000);
    expect(biggest).toBeLessThanOrEqual(4 * 1024 * 1024);
    await expect(parse(header(1) + '0 0 0')).resolves.toMatchObject({ count: 1 });
  });
  it.each(['char', 'uchar', 'short', 'ushort', 'int', 'uint', 'int8', 'uint32', 'float64'])('sniffs supported scalar coordinates %s', (type) => {
    expect(classifyPly(header(1).replaceAll('property float', `property\t${type}`))).toBe('points');
  });
  it('reports retained versus source count in the preset summary', () => {
    const text = presetConsequence({ kind: 'points', preset: 'auto', loadedPreset: null, detail: { sourceCount: 1000, retainedCount: 100 }, budget: {} as never });
    expect(text).toContain('100 of 1,000'); expect(text).not.toContain('all shown');
  });
});
