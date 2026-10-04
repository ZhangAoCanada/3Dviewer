import type { AssetSource, LoadProgress } from './types';
import { explainLoadError } from '../loaders/gaussian/explainLoadError';
import { formatBytes } from '../ui/format';

export type FailureKind = 'graphics' | 'format' | 'memory' | 'network' | 'stalled' | 'cancelled' | 'unknown';

export type FailureAction =
  | 'retry'
  | 'retry-lower-memory'
  | 'choose-file'
  | 'choose-folder'
  | 'open-file'
  | 'download-app'
  | 'reinit-graphics'
  | 'formats';

export interface Failure {
  kind: FailureKind;
  title: string;
  body: string;
  actions: FailureAction[];
  raw: string;
}

export class GraphicsUnavailableError extends Error {
  readonly reason: 'no-webgl2' | 'renderer-failed';
  readonly statusMessage?: string;

  constructor(
    reason: 'no-webgl2' | 'renderer-failed',
    message: string,
    statusMessage?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'GraphicsUnavailableError';
    this.reason = reason;
    this.statusMessage = statusMessage;
  }
}

export class LoadStalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadStalledError';
  }
}

export class MissingCompanionsError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(`Missing: ${missing.join(', ')}`);
    this.name = 'MissingCompanionsError';
    this.missing = missing;
  }
}

export interface FailureContext {
  source?: AssetSource;
  stage?: LoadProgress['stage'];
}

const MEMORY_PATTERN = /unreachable|out of bounds|out of memory|allocation failed|Invalid array length/i;
const NETWORK_STATUS_PATTERN = /Could not (?:download|read) .* \((\d+|network)\)|Range request returned/;
const FETCH_PATTERN = /Failed to fetch|NetworkError|Load failed|network/i;
const FORMAT_PATTERN = /Unsupported file|GLTFLoader|PLY|header/i;

/**
 * Classify a load or startup error into a card the user can act on.
 * Rules run in order. Each rule looks through the `cause` chain.
 */
export function classifyFailure(error: unknown, context?: FailureContext): Failure {
  const chain = causeChain(error);
  const raw = explainLoadError(error);

  if (chain.some(isPlainAbort)) {
    return { kind: 'cancelled', title: 'Loading cancelled', body: 'Loading cancelled.', actions: [], raw };
  }
  const stalled = chain.find(isStalled);
  if (stalled instanceof LoadStalledError || (stalled instanceof Error && stalled.name === 'LoadStalledError')) {
    return {
      kind: 'stalled',
      title: 'Loading stopped responding',
      body: stalled.message,
      actions: ['retry'],
      raw,
    };
  }
  if (chain.some(isGraphics)) {
    return {
      kind: 'graphics',
      title: 'Graphics are not available',
      body: graphicsBody(),
      actions: ['reinit-graphics', 'download-app'],
      raw,
    };
  }
  if (chain.some(isMemory)) {
    return {
      kind: 'memory',
      title: 'Not enough memory for this scene',
      body: memoryBody(context?.source),
      actions: ['retry-lower-memory', 'download-app'],
      raw,
    };
  }
  if (chain.some(isNetwork)) {
    return {
      kind: 'network',
      title: 'Could not download the file',
      body: networkBody(chain, context?.source),
      actions: ['retry', 'open-file'],
      raw,
    };
  }
  const missing = chain.map(missingList).find((list) => list != null);
  if (missing) {
    return {
      kind: 'format',
      title: 'Files missing for this model',
      body: `Missing: ${missing.join(', ')}. Select the model together with these files, or drop the whole folder. A single .glb avoids this.`,
      actions: ['choose-file', 'choose-folder'],
      raw,
    };
  }
  if (chain.some(isFormat) || context?.stage === 'parse') {
    return {
      kind: 'format',
      title: 'This file could not be read',
      body: 'It may be incomplete (still copying or syncing) or a variant Omniview does not read.',
      actions: ['choose-file', 'formats'],
      raw,
    };
  }
  return {
    kind: 'unknown',
    title: 'The file could not be opened',
    body: raw,
    actions: ['retry'],
    raw,
  };
}

/** Memory card shown when a previous tab died while opening a large file. */
export function crashBreadcrumbFailure(entry: { name: string; size: number | null }): Failure {
  const size = entry.size == null ? 'unknown size' : formatBytes(entry.size);
  return {
    kind: 'memory',
    title: 'Not enough memory for this scene',
    body: `Omniview closed while opening ${entry.name} (${size}). That usually means it ran out of memory.`,
    actions: ['retry-lower-memory', 'download-app'],
    raw: `Closed while opening ${entry.name}`,
  };
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current != null && !seen.has(current) && chain.length < 8) {
    seen.add(current);
    chain.push(current);
    if (typeof current === 'object' && current !== null && 'cause' in current) {
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  return chain;
}

function isPlainAbort(error: unknown): boolean {
  if (!(error instanceof Error) || error.name !== 'AbortError') return false;
  return error.cause == null;
}

function isStalled(error: unknown): boolean {
  return error instanceof LoadStalledError || (error instanceof Error && error.name === 'LoadStalledError');
}

function isGraphics(error: unknown): boolean {
  return (
    error instanceof GraphicsUnavailableError ||
    (error instanceof Error && error.name === 'GraphicsUnavailableError')
  );
}

function isMemory(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof RangeError || error.name === 'RangeError' || error.name === 'RuntimeError') return true;
  return MEMORY_PATTERN.test(error.message);
}

function isNetwork(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (NETWORK_STATUS_PATTERN.test(error.message)) return true;
  return error instanceof TypeError && FETCH_PATTERN.test(error.message);
}

function missingList(error: unknown): string[] | null {
  if (error instanceof MissingCompanionsError) return error.missing;
  if (!(error instanceof Error) || error.name !== 'MissingCompanionsError') return null;
  const missing = (error as { missing?: unknown }).missing;
  if (!Array.isArray(missing) || !missing.every((item) => typeof item === 'string')) return null;
  return missing;
}

function isFormat(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (
    error.name === 'GaussianPlyError' ||
    error.name === 'GaussianPlyUnsupported' ||
    error.name === 'PlyParseError' ||
    error.name === 'SyntaxError'
  ) {
    return true;
  }
  return FORMAT_PATTERN.test(error.message);
}

function graphicsBody(): string {
  return [
    'Turn on hardware acceleration and reload the page.',
    '',
    'Chrome: Settings → System → Use graphics acceleration when available.',
    'Edge: Settings → System and performance → Use graphics acceleration when available.',
    'Firefox: Settings → General → Performance → turn off Use recommended performance settings, then turn on Use hardware acceleration when available.',
    'Safari: Settings → Websites → WebGL, allow this site, then reload.',
  ].join('\n');
}

function memoryBody(source?: AssetSource): string {
  const name = source?.name ?? 'This file';
  const size = source?.sizeBytes == null ? 'unknown size' : formatBytes(source.sizeBytes);
  return `${name} (${size}). Device memory: ${deviceMemoryLabel()}. Close other tabs, then try again with lower memory, or get the desktop app.`;
}

function deviceMemoryLabel(): string {
  const nav =
    typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { deviceMemory?: number });
  const gb = nav?.deviceMemory;
  return gb == null ? 'unknown' : `${gb} GB`;
}

function networkBody(chain: unknown[], source?: AssetSource): string {
  const message = chain.find((item): item is Error => item instanceof Error)?.message ?? '';
  const status = statusOf(message);
  const host = source?.url ? safeHost(source.url) : '';
  const hostBit = host ? ` Host: ${host}.` : '';
  let why: string;
  if (status === '401' || status === '403') why = 'Access was denied.';
  else if (status === '404') why = 'The file was not found.';
  else if (status === '200' || status === '206') {
    why = 'The file arrived, but it was not the bytes that were requested.';
  } else if (status && status !== 'network') why = `The server returned status ${status}.`;
  else if (typeof navigator !== 'undefined' && navigator.onLine === false) why = 'You appear to be offline.';
  else if (!source?.url || isCrossOrigin(source.url)) why = 'The download was blocked by CORS or offline.';
  else why = 'The download failed before a status came back.';
  return `${why}${hostBit}`;
}

function statusOf(message: string): string | null {
  const match = /\((\d+|network)\)/.exec(message);
  if (match?.[1]) return match[1];
  const range = /Range request returned (\d+)/.exec(message);
  return range?.[1] ?? null;
}

function safeHost(url: string): string {
  try {
    return new URL(url, typeof location === 'undefined' ? undefined : location.href).host;
  } catch {
    return '';
  }
}

function isCrossOrigin(url: string): boolean {
  if (typeof location === 'undefined') return true;
  try {
    return new URL(url, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}
