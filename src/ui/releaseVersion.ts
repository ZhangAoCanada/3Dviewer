export const RELEASE_KEY = '3dviewer-release';
export const RELEASE_REFRESH_MS = 60_000;
export const RELEASE_BACKOFF_MAX_MS = 5 * 60_000;

const RELEASE_URL = 'https://api.github.com/repos/ZhangAoCanada/3Dviewer/releases/latest';
const STABLE_TAG = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export interface CachedRelease { tag: string; at: number }
interface StorageLike {
  getItem?(key: string): string | null;
  setItem?(key: string, value: string): void;
}
export type ReleaseCheck =
  | { kind: 'current'; tag: string }
  | { kind: 'unavailable'; retryAfterMs: number };
export type ReleaseVersionState =
  | { kind: 'checking'; version: string | null }
  | { kind: 'current' | 'cached'; version: string }
  | { kind: 'unavailable'; version: null };
interface ReleaseVersionOptions {
  storage: StorageLike;
  render: (state: ReleaseVersionState) => void;
  check?: () => Promise<ReleaseCheck>;
  now?: () => number;
}

/** Cache is a last-known display, never permission to skip the first check. */
export class ReleaseVersion {
  private version: string | null;
  private pending: Promise<void> | null = null;
  private nextCheck = -Infinity;
  private failures = 0;
  private readonly now: () => number;
  private readonly check: () => Promise<ReleaseCheck>;

  constructor(private readonly options: ReleaseVersionOptions) {
    this.now = options.now ?? Date.now;
    this.check = options.check ?? refreshRelease;
    const cached = readCachedRelease(options.storage);
    this.version = cached ? displayVersion(cached.tag) : null;
    options.render({ kind: 'checking', version: this.version });
  }

  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.now() < this.nextCheck) return Promise.resolve();
    this.options.render({ kind: 'checking', version: this.version });
    this.pending = Promise.resolve().then(() => this.check()).then((result) => {
      if (result.kind === 'current') {
        this.failures = 0;
        this.nextCheck = this.now() + RELEASE_REFRESH_MS;
        this.version = displayVersion(result.tag);
        writeCachedRelease(this.options.storage, result.tag, this.now());
        this.options.render({ kind: 'current', version: this.version });
      } else {
        this.failed(result.retryAfterMs);
      }
    }).catch(() => this.failed(0)).finally(() => { this.pending = null; });
    return this.pending;
  }

  private failed(retryAfterMs: number): void {
    this.failures = Math.min(this.failures + 1, 4);
    const backoff = Math.min(RELEASE_REFRESH_MS * 2 ** (this.failures - 1), RELEASE_BACKOFF_MAX_MS);
    this.nextCheck = this.now() + Math.max(backoff, retryAfterMs);
    this.options.render(this.version
      ? { kind: 'cached', version: this.version }
      : { kind: 'unavailable', version: null });
  }
}

/** A stable tag is separate from the running website's package version. */
export function parseLatestRelease(json: unknown): string | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  if ('draft' in json && json.draft !== false) return null;
  if ('prerelease' in json && json.prerelease !== false) return null;
  return 'tag_name' in json && typeof json.tag_name === 'string' && STABLE_TAG.test(json.tag_name)
    ? json.tag_name : null;
}

export function displayVersion(tag: string): string {
  return tag.startsWith('v') ? tag : `v${tag}`;
}

export function readCachedRelease(storage: StorageLike): CachedRelease | null {
  try {
    const raw = storage.getItem?.(RELEASE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !('tag' in parsed) || !('at' in parsed)) return null;
    if (typeof parsed.tag !== 'string' || typeof parsed.at !== 'number' || !Number.isFinite(parsed.at) || parsed.at < 0) return null;
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
    // The live result still displays when storage is unavailable.
  }
}

function retryDelay(response: Response): number {
  const retry = response.headers.get('retry-after');
  if (retry) {
    const seconds = Number(retry);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry) - Date.now();
    if (Number.isFinite(delay) && delay >= 0) return delay;
  }
  if (response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
    if (Number.isFinite(reset) && reset > 0) return reset;
  }
  return 0;
}

export async function refreshRelease(signal?: AbortSignal): Promise<ReleaseCheck> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 5000);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  try {
    const response = await fetch(RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      cache: 'no-cache',
      signal: combined,
    });
    if (!response.ok) return { kind: 'unavailable', retryAfterMs: retryDelay(response) };
    const tag = parseLatestRelease(await response.json());
    return tag ? { kind: 'current', tag } : { kind: 'unavailable', retryAfterMs: 0 };
  } catch {
    return { kind: 'unavailable', retryAfterMs: 0 };
  } finally {
    clearTimeout(timer);
  }
}
