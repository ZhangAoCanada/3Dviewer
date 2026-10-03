import { describe, expect, it } from 'vitest';
import type { LoadProgress } from '../src/core/types';
import { formatBytes } from '../src/ui/format';
import { phaseOf, progressLine, stallHint, STALL_HINT_MS } from '../src/ui/loadPhase';

const base = (stage: LoadProgress['stage'], extra: Partial<LoadProgress> = {}): LoadProgress => ({
  loaded: 0,
  stage,
  ...extra,
});

describe('phaseOf', () => {
  it('maps detect and download to reading, and parse and gpu to preparing', () => {
    expect(phaseOf(base('detect'))).toBe('reading');
    expect(phaseOf(base('download'))).toBe('reading');
    expect(phaseOf(base('parse'))).toBe('preparing');
    expect(phaseOf(base('gpu'))).toBe('preparing');
  });

  it('lets an explicit phase override the stage', () => {
    expect(phaseOf(base('parse', { phase: 'reading' }))).toBe('reading');
    expect(phaseOf(base('download', { phase: 'preparing' }))).toBe('preparing');
  });
});

describe('progressLine', () => {
  it('formats reading bytes and a percent', () => {
    const loaded = 1.5 * 1024 ** 3;
    const total = 2.5 * 1024 ** 3;
    const line = progressLine(base('download', { loaded, total, bytes: { loaded, total } }), null);
    expect(line).toBe('1.5 GB of 2.5 GB · 60%');
  });

  it('matches formatBytes for a 1.1 GB of 2.3 GB read', () => {
    const loaded = 1.1 * 1024 ** 3;
    const total = 2.3 * 1024 ** 3;
    const pct = Math.round((loaded / total) * 100);
    expect(progressLine(base('download', { loaded, total, bytes: { loaded, total } }), null)).toBe(
      `${formatBytes(loaded)} of ${formatBytes(total)} · ${pct}%`,
    );
  });

  it('omits the percent when the length is unknown', () => {
    expect(progressLine(base('download', { loaded: 2048, bytes: { loaded: 2048 } }), null)).toBe('2.0 KB');
  });

  it('uses the loader message while preparing and does not invent a GPU percent', () => {
    expect(progressLine(base('parse', { loaded: 5, total: 10, message: 'Decoding 5 / 10 splats' }), null)).toBe(
      'Decoding 5 / 10 splats',
    );
    const gpu = progressLine(base('gpu', { loaded: 10, total: 10, message: 'Uploading 10 splats' }), null);
    expect(gpu).toBe('Uploading 10 splats');
    expect(gpu).not.toContain('%');
  });
});

describe('stallHint', () => {
  const reading = { phase: 'reading' as const, stage: 'download' as const, origin: 'url' as const, host: 'files.example' };

  it('stays quiet until 10s, and until 20s on the GPU', () => {
    expect(STALL_HINT_MS).toBe(10_000);
    expect(stallHint({ ...reading, idleMs: 9_999 })).toBeNull();
    expect(stallHint({ ...reading, idleMs: 10_000 })).toMatch(/No data from/);
    expect(stallHint({ phase: 'preparing', stage: 'gpu', idleMs: 10_000, splats: 10 })).toBeNull();
    expect(stallHint({ phase: 'preparing', stage: 'gpu', idleMs: 19_999, splats: 10 })).toBeNull();
    expect(stallHint({ phase: 'preparing', stage: 'parse', idleMs: 9_999 })).toBeNull();
    expect(stallHint({ phase: 'preparing', stage: 'parse', idleMs: 10_000 })).toMatch(/Still decoding/);
  });

  it('names the remote host and the local-file pause', () => {
    expect(stallHint({ ...reading, idleMs: 14_000 })).toBe(
      'No data from files.example for 14 s. The server or connection may be slow. You can keep waiting or cancel.',
    );
    expect(stallHint({ phase: 'reading', stage: 'download', origin: 'file', idleMs: 14_000 })).toBe(
      'The browser has not read more of the file for 14 s. Files on network or cloud-synced drives can pause while they download.',
    );
  });

  it('explains a one-step decode and a GPU upload', () => {
    expect(stallHint({ phase: 'preparing', stage: 'parse', idleMs: 10_000 })).toBe(
      'Still decoding. Compressed formats (.spz, .sog) decode in one step and do not report progress.',
    );
    const splats = 200_000;
    expect(stallHint({ phase: 'preparing', stage: 'gpu', idleMs: 20_000, splats })).toBe(
      `Uploading ${splats.toLocaleString()} splats to the GPU in one step. The page can freeze until it finishes; Cancel applies right after.`,
    );
  });
});
