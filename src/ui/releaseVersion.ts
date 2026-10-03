/** `3dviewer-release` = `{ tag, at }`. A hit younger than this skips the network. */
export const RELEASE_TTL_MS = 12 * 60 * 60 * 1000;

export const RELEASE_KEY = '3dviewer-release';

const RELEASE_URL = 'https://api.github.com/repos/ZhangAoCanada/3Dviewer/releases/latest';

const TAG = /^v?\d+\.\d+\.\d+/;

export interface CachedRelease {
  tag: string;
  at: number;
}

interface StorageLike {
  getItem?(key: string): string | null;
  setItem?(key: string, value: string): void;
}

/** Accept a stable GitHub release tag. Drafts, prereleases, and garbage are rejected. */
export function parseLatestRelease(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const record = json as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
  if (record.draft === true || record.prerelease === true) return null;
  if (typeof record.tag_name !== 'string' || !TAG.test(record.tag_name)) return null;
  return record.tag_name;
}

/** Show a cached tag while it is younger than 12 h. Otherwise show the build and mark it stale. */
export function chooseVersion(args: {
  cached: CachedRelease | null;
  now: number;
  build: string;
}): { version: string; stale: boolean } {
  const cached = args.cached;
  if (
    cached &&
    Number.isFinite(cached.at) &&
    args.now - cached.at < RELEASE_TTL_MS &&
    parseLatestRelease({ tag_name: cached.tag })
  ) {
    return { version: displayVersion(cached.tag), stale: false };
  }
  return { version: displayVersion(args.build), stale: true };
}

export function displayVersion(tag: string): string {
  const match = /^v?(\d+\.\d+\.\d+.*)$/.exec(tag.trim());
  if (match?.[1]) return `v${match[1]}`;
  return tag.startsWith('v') ? tag : `v${tag}`;
}

export function readCachedRelease(storage: StorageLike): CachedRelease | null {
  let raw: string | null;
  try {
    raw = storage.getItem?.(RELEASE_KEY) ?? null;
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { tag?: unknown; at?: unknown };
    if (typeof parsed.tag !== 'string' || typeof parsed.at !== 'number' || !Number.isFinite(parsed.at)) return null;
    if (!parseLatestRelease({ tag_name: parsed.tag })) return null;
    return { tag: parsed.tag, at: parsed.at };
  } catch {
    return null;
  }
}

export function writeCachedRelease(storage: StorageLike, tag: string, at: number): void {
  try {
    storage.setItem?.(RELEASE_KEY, JSON.stringify({ tag, at }));
  } catch {
    /* quota or private mode */
  }
}

/** Latest stable tag, or null when the request fails. Nothing is logged. */
export async function refreshRelease(signal?: AbortSignal): Promise<string | null> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 5000);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  try {
    const res = await fetch(RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: combined,
    });
    if (!res.ok) return null;
    return parseLatestRelease(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
