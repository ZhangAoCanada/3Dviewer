import { afterEach, expect, it, vi } from 'vitest';
import { refreshRelease, type ReleaseCheck } from '../src/ui/releaseVersion';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it.each([403, 404, 429, 500])('optional release HTTP %s reports unavailable', async (status) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
  await expect(refreshRelease()).resolves.toEqual({ kind: 'unavailable', retryAfterMs: 0 });
});
it('accepts success, rejects missing/invalid JSON and network failures without throwing', async () => {
  const cases: [string, ReleaseCheck][] = [['{"tag_name":"v9.9.9"}', { kind: 'current', tag: 'v9.9.9' }], ['{}', { kind: 'unavailable', retryAfterMs: 0 }], ['not JSON', { kind: 'unavailable', retryAfterMs: 0 }]];
  for (const [body, expected] of cases) {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
    await expect(refreshRelease()).resolves.toEqual(expected);
  }
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  await expect(refreshRelease()).resolves.toEqual({ kind: 'unavailable', retryAfterMs: 0 });
});
it('caller abort cancels optional lookup and removes its timeout', async () => {
  vi.useFakeTimers(); const abort = new AbortController();
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError'))))));
  const pending = refreshRelease(abort.signal); abort.abort(); await expect(pending).resolves.toEqual({ kind: 'unavailable', retryAfterMs: 0 }); expect(vi.getTimerCount()).toBe(0);
});

it('revalidates HTTP metadata and accepts the authoritative stable response', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tag_name: 'v0.3.2' })));
  vi.stubGlobal('fetch', fetcher);
  expect(await refreshRelease()).toEqual({ kind: 'current', tag: 'v0.3.2' });
  expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/releases/latest'), expect.objectContaining({ cache: 'no-cache', headers: { Accept: 'application/vnd.github+json' } }));
});
it.each([403, 429, 503])('respects Retry-After on HTTP%i', async (status) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status, headers: { 'Retry-After': '120' } })));
  expect(await refreshRelease()).toEqual({ kind: 'unavailable', retryAfterMs: 120_000 });
});
it('honors HTTP-date and exhausted GitHub rate-limit reset times', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-20T11:00:00Z'));
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': 'Fri, 20 Nov 2026 11:03:00 GMT' } })).mockResolvedValueOnce(new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.now() / 1000 + 600) } }));
  vi.stubGlobal('fetch', fetcher);
  expect(await refreshRelease()).toEqual({ kind: 'unavailable', retryAfterMs: 180_000 });
  expect(await refreshRelease()).toEqual({ kind: 'unavailable', retryAfterMs: 600_000 });
});
it.each(['{', '{"tag_name":"v0.3.3junk"}', '{"tag_name":"v0.3.4","prerelease":true}'])('handles invalid live JSON %s without poisoning cache', async (body) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  expect(await refreshRelease()).toEqual({ kind: 'unavailable', retryAfterMs: 0 });
});
it('aborts a stalled optional request after five seconds', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_url, init?: RequestInit) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(Error('aborted'))); })));
  const pending = refreshRelease(); await vi.advanceTimersByTimeAsync(5000);
  expect(await pending).toEqual({ kind: 'unavailable', retryAfterMs: 0 });
});

it('respects the longer cooldown when GitHub exposes both retry and quota-reset headers', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-20T11:00:00Z'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403, headers: { 'Retry-After': '120', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.now() / 1000 + 600) } })));
  expect(await refreshRelease()).toEqual({ kind: 'unavailable', retryAfterMs: 600_000 });
});
