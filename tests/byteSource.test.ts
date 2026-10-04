import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodedContentLength, interpretHead, rangeSource } from '../src/core/byteSource';
import { detectMemoryBudget } from '../src/core/memoryBudget';
import { decodeGaussianPly } from '../src/loaders/gaussian/decodeGaussianPly';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('interpretHead', () => {
  it('ignores range metadata on a content-encoded response', () => {
    const head = interpretHead(
      new Headers({
        'content-length': '41416',
        'accept-ranges': 'bytes',
        'content-encoding': 'gzip',
      }),
    );
    expect(head.acceptRanges).toBe(false);
    expect(head.size).toBeUndefined();
    expect(decodedContentLength(new Headers({ 'content-encoding': 'gzip', 'content-length': '41416' }))).toBeUndefined();
  });

  it('keeps a decoded length and Accept-Ranges', () => {
    expect(
      interpretHead(
        new Headers({
          'content-length': '1191929',
          'accept-ranges': 'bytes',
        }),
      ),
    ).toEqual({ size: 1191929, acceptRanges: true });
  });
});

describe('rangeSource', () => {
  const torus = readFileSync(join(process.cwd(), 'public', 'samples', 'torus.ply'));

  it('slices a 206 window and asks again for the next one', async () => {
    const fetches: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const range = new Headers(init?.headers).get('range') ?? '';
        fetches.push(range);
        const match = /^bytes=(\d+)-(\d+)$/.exec(range);
        const start = Number(match?.[1] ?? 0);
        const end = Number(match?.[2] ?? 0) + 1;
        return new Response(Buffer.from(torus.subarray(start, end)), {
          status: 206,
          headers: { 'content-range': `bytes ${start}-${end - 1}/${torus.byteLength}` },
        });
      }),
    );
    const source = rangeSource('https://example.test/torus.ply', torus.byteLength, new AbortController().signal);
    const first = new Uint8Array(await source.read(0, 16));
    const second = new Uint8Array(await source.read(16, 32));
    expect(Buffer.from(first)).toEqual(Buffer.from(torus.subarray(0, 16)));
    expect(Buffer.from(second)).toEqual(Buffer.from(torus.subarray(16, 32)));
    expect(fetches).toEqual(['bytes=0-15', 'bytes=16-31']);
    expect(source.size).toBe(torus.byteLength);
  });

  it('decodes torus when a range request returns the whole file as 200', async () => {
    const fetches: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        fetches.push(new Headers(init?.headers).get('range') ?? '');
        return new Response(torus, {
          status: 200,
          headers: {
            'content-type': 'application/octet-stream',
            'content-encoding': 'gzip',
            'content-length': '41416',
            'accept-ranges': 'bytes',
          },
        });
      }),
    );
    const source = rangeSource('https://zhangaocanada.github.io/3Dviewer/samples/torus.ply', 41_416, new AbortController().signal);
    const decoded = await decodeGaussianPly(source, {
      budget: detectMemoryBudget({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        deviceMemory: 8,
        hardwareConcurrency: 8,
        maxTouchPoints: 0,
      }),
      preferExtended: false,
    });
    expect(decoded.count).toBe(4800);
    expect(decoded.mismatch).toBe(false);
    expect(source.size).toBe(torus.byteLength);
    expect(fetches).toEqual(['bytes=0-41415']);
  });

  it('rejects a real HTTP failure and an already-aborted signal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(rangeSource('https://example.test/missing.ply', 32, new AbortController().signal).read(0, 16)).rejects.toThrow(
      /404/,
    );
    const aborted = AbortSignal.abort(new DOMException('stopped', 'AbortError'));
    await expect(rangeSource('https://example.test/missing.ply', 32, aborted).read(0, 16)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('does not call a short 200 a status failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(4), { status: 200 })));
    const error = await rangeSource('https://example.test/short.ply', 32, new AbortController().signal)
      .read(0, 16)
      .then(
        () => {
          throw new Error('expected rejection');
        },
        (reason: unknown) => reason,
      );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toMatch(/status 200/i);
    expect((error as Error).message).toMatch(/4 bytes/);
  });
});
