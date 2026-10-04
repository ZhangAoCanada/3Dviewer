/** Sequential byte window. Callers read `[start, end)` and never need the whole file. */
export interface ByteSource {
  size: number;
  read(start: number, end: number): Promise<ArrayBuffer>;
}

/** What a HEAD response says about ranged reads. */
export interface HeadProbe {
  size?: number;
  /** True only when byte ranges address the decoded body. */
  acceptRanges: boolean;
}

export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read(start, end) {
      return blob.slice(start, end).arrayBuffer();
    },
  };
}

/**
 * Content-Length of a decoded body.
 * A gzip/br Content-Length counts the compressed bytes, so it is not the file size.
 */
export function decodedContentLength(headers: { get(name: string): string | null }): number | undefined {
  if (contentEncoded(headers)) return undefined;
  const parsed = Number(headers.get('content-length'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * HEAD metadata for a range decision.
 * Content-Encoding means Accept-Ranges addresses the compressed bytes, and
 * Content-Length is not the decoded file. Range reads are not safe then.
 */
export function interpretHead(headers: { get(name: string): string | null }): HeadProbe {
  if (contentEncoded(headers)) return { acceptRanges: false };
  const size = decodedContentLength(headers);
  const accept = (headers.get('accept-ranges') ?? '').toLowerCase().includes('bytes');
  return { size, acceptRanges: accept };
}

/** Above this, a Range response of 200 is refused instead of buffered. */
const WHOLE_FILE_LIMIT = 64 * 1024 * 1024;

/**
 * HTTP Range reader.
 * Status 206 is the requested window. Status 200 is a successful whole-object
 * response (a precache that ignored Range, or a server that sent the file).
 * The whole object is kept so later reads slice it, and `size` becomes that
 * byte length when the advertised length was the compressed size.
 */
export function rangeSource(url: string, size: number, signal: AbortSignal): ByteSource {
  let fileSize = size;
  let whole: ArrayBuffer | undefined;
  return {
    get size() {
      return fileSize;
    },
    async read(start, end) {
      if (signal.aborted) throw abortError(signal);
      if (whole) return whole.slice(start, end);
      const res = await fetch(url, {
        headers: { Range: `bytes=${start}-${end - 1}` },
        signal,
      });
      if (signal.aborted) throw abortError(signal);
      if (res.status === 206) {
        const buf = await res.arrayBuffer();
        const requested = end - start;
        if (buf.byteLength !== requested) {
          throw new Error(
            `Range response contained ${buf.byteLength} bytes; the requested window was ${requested} bytes.`,
          );
        }
        return buf;
      }
      if (res.status === 200) {
        const buf = await readLimitedBody(res, signal, WHOLE_FILE_LIMIT);
        const requested = end - start;
        if (buf.byteLength < end) {
          throw new Error(`Download finished with ${buf.byteLength} bytes; the requested range ended at ${end}.`);
        }
        if (buf.byteLength !== requested) {
          fileSize = buf.byteLength;
          whole = buf;
        }
        return buf.slice(start, end);
      }
      throw new Error(`Range request returned ${res.status}, expected 206.`);
    },
  };
}

function contentEncoded(headers: { get(name: string): string | null }): boolean {
  const encoding = (headers.get('content-encoding') ?? '').trim().toLowerCase();
  return encoding.length > 0 && encoding !== 'identity';
}

function abortError(signal: AbortSignal): DOMException {
  const reason = signal.reason;
  if (reason instanceof DOMException && reason.name === 'AbortError') return reason;
  return new DOMException('The operation was aborted.', 'AbortError');
}

async function readLimitedBody(res: Response, signal: AbortSignal, limit: number): Promise<ArrayBuffer> {
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > limit) {
      throw new Error('The server sent the whole file instead of the requested byte range.');
    }
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  try {
    while (true) {
      if (signal.aborted) throw abortError(signal);
      const { done, value } = await reader.read();
      if (done || !value) break;
      loaded += value.byteLength;
      if (loaded > limit) {
        throw new Error('The server sent the whole file instead of the requested byte range.');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (signal.aborted) throw abortError(signal);
    throw error;
  }
  const out = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}
