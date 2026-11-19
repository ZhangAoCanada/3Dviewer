import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { expect, it, vi } from 'vitest';

it('serves precached HEAD/Range after a cold worker restart, never substituting runtime HTML', async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const net = vi.fn(async () => new Response('not found', { status: 404 }));
  const url = 'https://site.test/3Dviewer/sample.ply';
  const cache = { keys: async () => [new Request(url)], match: async (request: Request) => request.url.split('?')[0] === url ? new Response(new Uint8Array([1, 2, 3, 4])) : undefined };
  vm.runInNewContext(readFileSync('public/sw-update.js', 'utf8'), {
    self: { location: { origin: 'https://site.test' }, addEventListener: (name: string, callback: (event: unknown) => void) => listeners.set(name, callback) },
    caches: { keys: async () => ['pages', 'workbox-precache-v1'], open: async () => cache, match: cache.match },
    fetch: net, URL, Request, Response, Headers, Blob, setTimeout, clearTimeout,
  });
  const dispatch = (request: Request) => {
    let response: Promise<Response> | undefined;
    listeners.get('fetch')?.({ request, stopImmediatePropagation() {}, respondWith(p: Promise<Response>) { response = p; } });
    return response;
  };
  const response = await dispatch(new Request(url, { headers: { Range: 'bytes=1-2' } }));
  expect(response?.status).toBe(206); expect(Array.from(new Uint8Array(await response!.arrayBuffer()))).toEqual([2, 3]);
  const head = await dispatch(new Request(url, { method: 'HEAD' })); expect(head?.headers.get('content-length')).toBe('4');
  const missing = await dispatch(new Request('https://site.test/missing.ply', { headers: { Range: 'bytes=0-1' } })); expect(missing?.status).toBe(404);
  expect(dispatch(new Request('https://foreign.test/sample.ply', { method: 'HEAD' }))).toBeUndefined();
});
