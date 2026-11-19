import { afterEach, expect, it, vi } from 'vitest';
import { classifyPly, headerText, readFormatProbe, sourceFromFile, sourceFromUrl } from '../src/core/sniff';
import { PLY_HEADER_LIMIT } from '../src/core/plyLimits';
afterEach(() => vi.unstubAllGlobals());
const longHeader = 'ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\ncomment ' + 'a'.repeat(300000) + '\nproperty float y\nproperty float z\nend_header\n';
it('extends an incomplete prefix within the shared cap, including declarations past 256 KiB', async () => {
  const ends: number[] = [];
  class VirtualFile extends File {
    override get size() { return 1_000_000_000; }
    override slice(start = 0, end = this.size) {
      ends.push(end); expect(end).toBeLessThanOrEqual(PLY_HEADER_LIMIT);
      return new Blob([longHeader + '1 2 3\n']).slice(start, end);
    }
  }
  const bytes = await readFormatProbe(sourceFromFile(new VirtualFile([], 'virtual.ply')));
  expect(ends).toEqual([65536, PLY_HEADER_LIMIT]);
  expect(classifyPly(headerText(bytes))).toBe('points');
});
it('rejects incomplete and over-budget headers; abort is not a format decision', async () => {
  for (const text of ['ply\nproperty float x\n', 'ply\ncomment ' + 'x'.repeat(PLY_HEADER_LIMIT) + '\nend_header\n']) {
    await expect(readFormatProbe(sourceFromFile(new File([text], 'bad.ply')))).rejects.toThrow(/header.*incomplete|header limit/i);
  }
  const abort = new AbortController(); abort.abort();
  await expect(readFormatProbe(sourceFromFile(new File([longHeader], 'cloud.ply')), abort.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
it('does not assign points to completed invalid headers or Gaussian names in comments', () => {
  expect(classifyPly('ply\nelement vertex 1\nproperty float x\nend_header\n')).toBe('not-ply');
  expect(classifyPly(longHeader.replace('comment ', 'comment scale_0 f_dc_0 '))).toBe('points');
  expect(classifyPly(longHeader.replace('end_header', 'property float f_dc_0\nend_header'))).toBe('gaussian');
});
it('bounds prefix reads and cancels an oversized range-unaware remote stream', async () => {
  let canceled = false;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(longHeader + '1 2 3\n' + 'x'.repeat(2 * PLY_HEADER_LIMIT)));
  }, cancel() { canceled = true; } }))));
  const bytes = await readFormatProbe(sourceFromUrl('https://data.invalid/cloud.ply'));
  expect(bytes.byteLength).toBeLessThanOrEqual(PLY_HEADER_LIMIT); expect(canceled).toBe(true);
  expect(classifyPly(headerText(bytes))).toBe('points');
});
