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
it('keeps coherent partial reads and sends the strong validator as If-Range', async () => {
  const validators: (string | null)[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers); validators.push(headers.get('if-range'));
    const start = headers.get('range') === 'bytes=0-3' ? 0 : 4;
    return new Response(new Uint8Array([start, 1, 2, 3]), { status: 206, headers: { 'Content-Range': `bytes ${start}-${start + 3}/8`, ETag: '"stable"' } });
  }));
  const source = rangeSource('https://test.invalid/data', 8, new AbortController().signal);
  await source.read(0, 4); expect(new Uint8Array(await source.read(4, 8))[0]).toBe(4);
  expect(validators).toEqual([null, '"stable"']);
});
it('rejects encoded or oversized 206 bodies independently of truncation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(4), { status: 206, headers: { 'Content-Range': 'bytes 0-3/8', 'Content-Encoding': 'gzip' } })));
  await expect(rangeSource('https://test.invalid/data', 8, new AbortController().signal).read(0, 4)).rejects.toThrow(/encoded/i);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(8), { status: 206, headers: { 'Content-Range': 'bytes 0-3/8' } })));
  await expect(rangeSource('https://test.invalid/data', 8, new AbortController().signal).read(0, 4)).rejects.toThrow();
});
it('aborts while reading a body rather than returning incomplete data', async () => {
  const abort = new AbortController();
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array([1])); abort.abort(); controller.close(); } }), { status: 206, headers: { 'Content-Range': 'bytes 0-3/8' } })));
  await expect(rangeSource('https://test.invalid/data', 8, abort.signal).read(0, 4)).rejects.toMatchObject({ name: 'AbortError' });
});

it.each(['ETag', 'Last-Modified'])('cross-origin %s keeps simple requests but rejects a validator change', async (field) => {
  vi.stubGlobal('location', { href: 'https://app.invalid/3Dviewer/', origin: 'https://app.invalid' });
  const sent: (string | null)[] = []; let count = 0;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const headers = new Headers(init.headers); sent.push(headers.get('if-range'));
    const start = count++ === 0 ? 0 : 4;
    return new Response(new Uint8Array(4), { status: 206, headers: { 'Content-Range': `bytes ${start}-${start + 3}/8`, [field]: start ? 'new' : 'old' } });
  }));
  const source = rangeSource('https://data.invalid/scene.ply', 8, new AbortController().signal);
  await source.read(0, 4); await expect(source.read(4, 8)).rejects.toThrow(/validator changed/i);
  expect(sent).toEqual([null, null]);
});
