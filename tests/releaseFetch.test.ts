import { afterEach, expect, it, vi } from 'vitest';
import { refreshRelease } from '../src/ui/releaseVersion';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([403, 404, 429, 500])('optional release HTTP %s returns null', async (status) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
  await expect(refreshRelease()).resolves.toBeNull();
});
it('accepts success, rejects missing/invalid JSON and network failures without throwing', async () => {
  for (const [body, expected] of [['{"tag_name":"v9.9.9"}', 'v9.9.9'], ['{}', null], ['not JSON', null]] as const) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    await expect(refreshRelease()).resolves.toBe(expected);
  }
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  await expect(refreshRelease()).resolves.toBeNull();
});
it('caller abort cancels optional lookup and removes its timeout', async () => {
  vi.useFakeTimers(); const abort = new AbortController();
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError'))))));
  const pending = refreshRelease(abort.signal); abort.abort(); await expect(pending).resolves.toBeNull(); expect(vi.getTimerCount()).toBe(0);
});
