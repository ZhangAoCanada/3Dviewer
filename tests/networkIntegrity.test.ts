import { afterEach, expect, it, vi } from 'vitest';
import { rangeSource } from '../src/core/byteSource';
afterEach(() => vi.unstubAllGlobals());
it.each(['bytes 0-3/12', 'bytes 4-7/99', 'bytes */12', 'garbage', null])('rejects incoherent/unexposed Content-Range %s', async (range) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(4), { status: 206, headers: range ? { 'Content-Range': range } : {} })));
  await expect(rangeSource('https://test.invalid/data', 12, new AbortController().signal).read(4, 8)).rejects.toThrow(/range|size|expos/i);
});
it('rejects a changed validator and never combines a partial object with a whole replacement', async () => {
  let call = 0;
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(4), { status: 206, headers: { 'Content-Range': call++ === 0 ? 'bytes 0-3/12' : 'bytes 4-7/12', ETag: call === 1 ? '"old"' : '"new"' } })));
  const source = rangeSource('https://test.invalid/data', 12, new AbortController().signal);
  await source.read(0, 4); await expect(source.read(4, 8)).rejects.toThrow(/changed|coher/i);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(12))));
  await expect(source.read(4, 8)).rejects.toThrow(/changed|partial|coher/i);
});
it('rejects truncated and content-encoded partial bodies', async () => {
  const cases: Record<string, string>[] = [{ 'Content-Range': 'bytes 0-3/12' }, { 'Content-Range': 'bytes 0-3/12', 'Content-Encoding': 'gzip' }];
  for (const headers of cases) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(3), { status: 206, headers })));
    await expect(rangeSource('https://test.invalid/data', 12, new AbortController().signal).read(0, 4)).rejects.toThrow();
  }
});
