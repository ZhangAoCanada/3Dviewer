import { describe, expect, it, vi } from 'vitest';
import { displayVersion, parseLatestRelease, readCachedRelease, RELEASE_KEY, RELEASE_REFRESH_MS, ReleaseVersion, writeCachedRelease, type CachedRelease, type ReleaseCheck, type ReleaseVersionState } from '../src/ui/releaseVersion';


function harness(cached: CachedRelease | null = null) {
  let now = 1_700_000_000_000;
  const data = new Map<string, string>();
  if (cached) data.set(RELEASE_KEY, JSON.stringify(cached));
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const render = vi.fn<(state: ReleaseVersionState) => void>();
  const check = vi.fn<() => Promise<ReleaseCheck>>().mockResolvedValue({ kind: 'current', tag: 'v0.3.3' });
  const tracker = new ReleaseVersion({ storage, render, check, now: () => now });
  return { data, storage, render, check, tracker, advance: (ms: number) => { now += ms; } };
}

it.each(['v1.2.3', '9.9.9', 'v0.0.0', 'v1.2.3+build.4'])('accepts stable tag %s', (tag) => {
  expect(parseLatestRelease({ tag_name: tag, draft: false, prerelease: false })).toBe(tag);
});
it.each(['latest', 'v1.2', 'v1.2.3junk', 'v1.2.3-rc.1', 'v01.2.3', 'v1.2.3+'])('rejects invalid stable tag %s', (tag) => {
  expect(parseLatestRelease({ tag_name: tag })).toBeNull();
});
it.each([null, 'v1.2.3', [], { tag_name: 'v1.2.3', draft: true }, { tag_name: 'v1.2.3', prerelease: true }, { tag_name: 'v1.2.3', draft: 'false' }])('rejects invalid release metadata %j', (data) => {
  expect(parseLatestRelease(data)).toBeNull();
});

it('round-trips the existing cache key without touching preferences', () => {
  const h = harness(); h.data.set('3dviewer-theme', 'light');
  writeCachedRelease(h.storage, 'v3.1.0', 42);
  expect(readCachedRelease(h.storage)).toEqual({ tag: 'v3.1.0', at: 42 });
  expect(h.data.get('3dviewer-theme')).toBe('light');
  expect(displayVersion('9.9.9')).toBe('v9.9.9');
});
it.each(['{', '{}', '[]', '{"tag":"nope","at":1}', '{"tag":"v1.0.0"}', '{"tag":"v1.0.0","at":-1}'])('ignores corrupt cache %s', (raw) => {
  expect(readCachedRelease({ getItem: () => raw })).toBeNull();
});
it('storage denial does not hide a successful live release', async () => {
  const render = vi.fn();
  const tracker = new ReleaseVersion({ storage: { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('quota'); } }, render, check: async () => ({ kind: 'current', tag: 'v0.3.3' }) });
  await tracker.refresh();
  expect(render).toHaveBeenLastCalledWith({ kind: 'current', version: 'v0.3.3' });
});

describe('release revalidation policy', () => {
  it.each([1_699_999_999_999, 0, 1_800_000_000_000])('always revalidates an old tag, regardless of cached timestamp %i', async (at) => {
    const h = harness({ tag: 'v0.3.2', at });
    expect(h.render).toHaveBeenLastCalledWith({ kind: 'checking', version: 'v0.3.2' });
    await h.tracker.refresh();
    expect(h.check).toHaveBeenCalledTimes(1);
    expect(h.render).toHaveBeenLastCalledWith({ kind: 'current', version: 'v0.3.3' });
    expect(readCachedRelease(h.storage)?.tag).toBe('v0.3.3');
  });
  it('trusts actual installer metadata even when website or cached versions are ahead', async () => {
    const h = harness({ tag: 'v99.0.0', at: 1_800_000_000_000 });
    h.check.mockResolvedValue({ kind: 'current', tag: 'v0.3.2' });
    await h.tracker.refresh();
    expect(h.render).toHaveBeenLastCalledWith({ kind: 'current', version: 'v0.3.2' });
  });
  it('deduplicates concurrent focus, startup and dialog checks', async () => {
    const h = harness(); let finish = (_result: ReleaseCheck) => {};
    h.check.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const first = h.tracker.refresh(); const second = h.tracker.refresh();
    expect(first).toBe(second); await Promise.resolve();
    expect(h.check).toHaveBeenCalledTimes(1);
    finish({ kind: 'current', tag: 'v0.3.3' }); await first;
    await h.tracker.refresh(); expect(h.check).toHaveBeenCalledTimes(1);
    h.check.mockResolvedValue({ kind: 'current', tag: 'v0.3.3' });
    h.advance(RELEASE_REFRESH_MS); await h.tracker.refresh();
    expect(h.check).toHaveBeenCalledTimes(2);
  });
  it('keeps last-known metadata visibly cached on error and backs off without polling', async () => {
    const h = harness({ tag: 'v0.3.2', at: 1 });
    h.check.mockResolvedValue({ kind: 'unavailable', retryAfterMs: 0 });
    for (const delay of [60_000, 120_000, 240_000, 300_000, 300_000]) {
      const calls = h.check.mock.calls.length; await h.tracker.refresh();
      expect(h.check).toHaveBeenCalledTimes(calls + 1);
      expect(h.render).toHaveBeenLastCalledWith({ kind: 'cached', version: 'v0.3.2' });
      h.advance(delay - 1); await h.tracker.refresh(); expect(h.check).toHaveBeenCalledTimes(calls + 1); h.advance(1);
    }
  });
  it('does not claim the website version is an available installer when no metadata exists', async () => {
    const h = harness(); h.check.mockRejectedValue(Error('offline'));
    await h.tracker.refresh();
    expect(h.render).toHaveBeenLastCalledWith({ kind: 'unavailable', version: null });
    expect(h.data.has(RELEASE_KEY)).toBe(false);
  });
  it('honors a server cooldown, then recovers and resets failure backoff', async () => {
    const h = harness(); h.check.mockResolvedValue({ kind: 'unavailable', retryAfterMs: 600_000 });
    await h.tracker.refresh(); h.advance(599_999); await h.tracker.refresh(); expect(h.check).toHaveBeenCalledTimes(1);
    h.advance(1); h.check.mockResolvedValue({ kind: 'current', tag: 'v0.3.3' }); await h.tracker.refresh();
    h.advance(60_000); h.check.mockResolvedValue({ kind: 'unavailable', retryAfterMs: 0 }); await h.tracker.refresh();
    h.advance(60_000); await h.tracker.refresh(); expect(h.check).toHaveBeenCalledTimes(4);
  });
});
