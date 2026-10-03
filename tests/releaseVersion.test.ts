import { describe, expect, it } from 'vitest';
import {
  chooseVersion,
  displayVersion,
  parseLatestRelease,
  readCachedRelease,
  RELEASE_TTL_MS,
  writeCachedRelease,
} from '../src/ui/releaseVersion';

describe('parseLatestRelease', () => {
  it('accepts a stable tag and rejects drafts, prereleases, and garbage', () => {
    expect(parseLatestRelease({ tag_name: 'v1.2.3' })).toBe('v1.2.3');
    expect(parseLatestRelease({ tag_name: '9.9.9' })).toBe('9.9.9');
    expect(parseLatestRelease({ tag_name: 'v1.2.3', draft: true })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'v1.2.3', prerelease: true })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'latest' })).toBeNull();
    expect(parseLatestRelease({ tag_name: 'v1.2' })).toBeNull();
    expect(parseLatestRelease(null)).toBeNull();
    expect(parseLatestRelease('v1.2.3')).toBeNull();
  });
});

describe('chooseVersion', () => {
  const now = 1_700_000_000_000;

  it('keeps a cache entry younger than 12 h and falls back on the boundary', () => {
    expect(chooseVersion({ cached: { tag: 'v9.9.9', at: now - RELEASE_TTL_MS + 1 }, now, build: '0.2.0' })).toEqual({
      version: 'v9.9.9',
      stale: false,
    });
    expect(chooseVersion({ cached: { tag: 'v9.9.9', at: now - RELEASE_TTL_MS }, now, build: '0.2.0' })).toEqual({
      version: 'v0.2.0',
      stale: true,
    });
    expect(chooseVersion({ cached: null, now, build: '0.2.0' })).toEqual({ version: 'v0.2.0', stale: true });
    expect(displayVersion('9.9.9')).toBe('v9.9.9');
  });
});

describe('release cache', () => {
  it('round-trips a tag and rejects a corrupt entry', () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
    };
    writeCachedRelease(storage, 'v3.1.0', 42);
    expect(readCachedRelease(storage)).toEqual({ tag: 'v3.1.0', at: 42 });
    expect(mem.get('3dviewer-release')).toBe(JSON.stringify({ tag: 'v3.1.0', at: 42 }));

    mem.set('3dviewer-release', '{');
    expect(readCachedRelease(storage)).toBeNull();
    mem.set('3dviewer-release', JSON.stringify({ tag: 'nope', at: 1 }));
    expect(readCachedRelease(storage)).toBeNull();
    mem.set('3dviewer-release', JSON.stringify({ tag: 'v1.0.0' }));
    expect(readCachedRelease(storage)).toBeNull();
    expect(readCachedRelease({ getItem: () => { throw new Error('blocked'); } })).toBeNull();
  });
});
