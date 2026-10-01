/** Sequential byte window. Callers read `[start, end)` and never need the whole file. */
export interface ByteSource {
  size: number;
  read(start: number, end: number): Promise<ArrayBuffer>;
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read(start: number, end: number) {
      return blob.slice(start, end).arrayBuffer();
    },
  };
}

/**
 * HTTP Range reader. `read` requires status 206 so a server that ignores Range
 * cannot silently return the whole object as a 200.
 */
export function rangeSource(url: string, size: number, signal: AbortSignal): ByteSource {
  return {
    size,
    async read(start: number, end: number) {
      const res = await fetch(url, {
        headers: { Range: `bytes=${start}-${end - 1}` },
        signal,
      });
      if (res.status !== 206) {
        throw new Error(`Range request returned ${res.status}, expected 206.`);
      }
      return res.arrayBuffer();
    },
  };
}
