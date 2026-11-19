import { expect, it } from 'vitest';
import { blobSource } from '../src/core/byteSource';
import { classifyPly, headerText, readFormatProbe, sourceFromFile } from '../src/core/sniff';
import { PLY_HEADER_LIMIT } from '../src/core/plyLimits';
import { parsePlyPoints } from '../src/loaders/points/parsePly';
import { decodeGaussianPly, readGaussianPlyHeader } from '../src/loaders/gaussian/decodeGaussianPly';

const endings = ['\n', '\r\n', '\r'];
const spaces = ['', ' ', '\t', ' \t '];
const props = ['x', 'y', 'z'];
const gaussianProps = [...props, 'f_dc_0', 'f_dc_1', 'f_dc_2', 'opacity', 'scale_0', 'scale_1', 'scale_2', 'rot_0', 'rot_1', 'rot_2', 'rot_3'];
function fixture(format: string, terminator: string, gaussian = false): { header: string; file: File } {
  const fields = gaussian ? gaussianProps : props;
  const header = `ply\nformat ${format} 1.0\ncomment end_header is not a terminator\nelement vertex 1\n${fields.map(p => `property float ${p}\n`).join('')}${terminator}`;
  const body = format === 'ascii' ? Buffer.from('1 2 3\n') : Buffer.alloc(fields.length * 4);
  if (format !== 'ascii') {
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    fields.forEach((_, i) => view.setFloat32(i * 4, i < 3 ? i + 1 : 0, format === 'binary_little_endian'));
  }
  return { header, file: new File([header, body], 'boundary.ply') };
}
for (const ending of endings) for (const whitespace of spaces) {
  it(`preserves probe, ASCII, both binary offsets and Gaussian boundary for ${JSON.stringify(whitespace + ending)}`, async () => {
    for (const format of ['ascii', 'binary_little_endian', 'binary_big_endian']) {
      const { file, header } = fixture(format, `end_header${whitespace}${ending}`);
      const parsed = await parsePlyPoints(blobSource(file), 100);
      expect(parsed.count).toBe(1);
      expect(parsed.origin).toEqual([1, 2, 3]);
      const bytes = await readFormatProbe(sourceFromFile(file));
      expect(classifyPly(headerText(bytes))).toBe('points');
      expect(headerText(bytes)).not.toContain('1 2 3');
      expect(headerText(bytes).trimEnd()).toBe(header.trimEnd());
    }
    for (const format of ['binary_little_endian', 'binary_big_endian']) {
      const { file, header } = fixture(format, `end_header${whitespace}${ending}`, true);
      const parsed = await readGaussianPlyHeader(blobSource(file));
      expect(parsed.headerCount).toBe(1);
      expect(parsed.byteLength).toBe(header.length);
      const decoded = await decodeGaussianPly(blobSource(file), {
        budget: { profile: 'desktop', cpuBytes: 512 * 1024 * 1024, maxPoints: 100, maxSplatsResident: 100, maxSh: 0, pixelRatioCap: 2 },
        preferExtended: false,
      });
      expect(decoded.count).toBe(1);
      expect(decoded.sourceCount).toBe(1);
      expect(decoded.origin).toEqual([1, 2, 3]);
      expect(classifyPly(headerText(await readFormatProbe(sourceFromFile(file))))).toBe('gaussian');
    }
  });
}
it.each(['comment end_header\n', ' end_header\n', 'end_headerExtra\n', 'end_header #comment\n', 'end_header\v\n', 'END_HEADER\n', 'end_header'])('rejects non-boundary %j consistently', async (terminator) => {
  const { file } = fixture('ascii', terminator);
  await expect(readFormatProbe(sourceFromFile(file))).rejects.toThrow(/header/);
  await expect(parsePlyPoints(blobSource(file), 100)).rejects.toThrow();
  const gaussian = fixture('binary_little_endian', terminator, true);
  await expect(readGaussianPlyHeader(blobSource(gaussian.file))).rejects.toThrow(/header/);
});
it('slices classification before body lookalikes even after trailing whitespace', async () => {
  const { header } = fixture('ascii', 'end_header \t\r\n');
  const file = new File([header, '1 2 3\nelement chunk 1\nproperty float f_dc_0\n'], 'body.ply');
  expect(classifyPly(headerText(await readFormatProbe(sourceFromFile(file))))).toBe('points');
});
it('requires the complete boundary within the shared cap, not just the keyword', async () => {
  const prefix = 'ply\nformat ascii 1.0\ncomment ';
  const suffix = '\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header \t\r\n';
  const exact = prefix + 'x'.repeat(PLY_HEADER_LIMIT - prefix.length - suffix.length) + suffix;
  const good = new File([exact, '1 2 3\n'], 'exact.ply');
  expect(classifyPly(headerText(await readFormatProbe(sourceFromFile(good))))).toBe('points');
  expect((await parsePlyPoints(blobSource(good), 100)).count).toBe(1);
  const over = new File([exact.slice(0, -2), ' \r\n1 2 3\n'], 'over.ply');
  await expect(readFormatProbe(sourceFromFile(over))).rejects.toThrow(/header/);
  await expect(parsePlyPoints(blobSource(over), 100)).rejects.toThrow(/header/);
});

it('extends a prefix ending at CR instead of splitting a CRLF payload offset', async () => {
  const { header } = fixture('ascii', 'end_header \t\r\n');
  const padding = 'comment ' + 'x'.repeat(65537 - header.length - 'comment \n'.length) + '\n';
  const text = header.replace('element vertex', padding + 'element vertex');
  expect(text.charCodeAt(65535)).toBe(13);
  const file = new File([text, '1 2 3\n'], 'split.ply');
  const bytes = await readFormatProbe(sourceFromFile(file));
  expect(bytes.length).toBeGreaterThan(65536);
  expect(classifyPly(headerText(bytes))).toBe('points');
  expect((await parsePlyPoints(blobSource(file), 100)).origin).toEqual([1, 2, 3]);
});
