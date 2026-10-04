import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBlobWithProgress, type ByteCount } from '../src/core/fetchProgress';

afterEach(() => {
  vi.unstubAllGlobals();
});

function streamOf(parts: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

describe('fetchBlobWithProgress', () => {
  it('reports increasing bytes and a final total, and the blob matches the chunks', async () => {
    const parts = [3, 5, 8, 13, 21].map((size) => new Uint8Array(size).fill(size));
    const sum = parts.reduce((total, part) => total + part.byteLength, 0);
    const calls: ByteCount[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(streamOf(parts), { status: 200, headers: { 'content-length': String(sum) } })),
    );
    const blob = await fetchBlobWithProgress('https://example.test/scan.ply', new AbortController().signal, (bytes) => {
      calls.push(bytes);
    });
    expect(calls.map((entry) => entry.loaded)).toEqual([3, 8, 16, 29, 50]);
    expect(calls.every((entry) => entry.total === sum)).toBe(true);
    expect(calls[calls.length - 1]?.loaded).toBe(sum);
    expect(blob.size).toBe(sum);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(bytes.length).toBe(sum);
    expect(bytes[0]).toBe(3);
    expect(bytes[sum - 1]).toBe(21);
  });

  it('rejects with AbortError when the signal is already aborted', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const signal = AbortSignal.abort(new DOMException('stopped', 'AbortError'));
    await expect(fetchBlobWithProgress('https://example.test/scan.ply', signal, () => {})).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps a 200 whose content-length is the compressed size', async () => {
    const body = new Uint8Array(50).fill(7);
    const calls: ByteCount[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(body, {
            status: 200,
            headers: {
              'content-type': 'application/octet-stream',
              'content-encoding': 'gzip',
              'content-length': '10',
            },
          }),
      ),
    );
    const blob = await fetchBlobWithProgress('https://example.test/scan.ply', new AbortController().signal, (bytes) => {
      calls.push(bytes);
    });
    expect(blob.size).toBe(50);
    expect(new Uint8Array(await blob.arrayBuffer())[0]).toBe(7);
    expect(calls.every((entry) => entry.total === undefined)).toBe(true);
    expect(calls[calls.length - 1]?.loaded).toBe(50);
  });

  it('rejects with AbortError when the signal aborts while reading', async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({
      pull(ctrl) {
        ctrl.enqueue(new Uint8Array(8));
        controller.abort();
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-length': '64' } })),
    );
    await expect(fetchBlobWithProgress('https://example.test/scan.ply', controller.signal, () => {})).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
