/** Fold downloaded chunks into one Blob this often, so a large file can stay on disk. */
const FOLD_BYTES = 32 * 1024 * 1024;

export interface ByteCount {
  loaded: number;
  total?: number;
}

function abortError(signal: AbortSignal): DOMException {
  const reason = signal.reason;
  if (reason instanceof DOMException && reason.name === 'AbortError') return reason;
  return new DOMException('The operation was aborted.', 'AbortError');
}

/**
 * Download `url` and report bytes as they arrive.
 * Chunks are folded into a Blob every 32 MB (`blob = new Blob([blob, ...chunks])`).
 */
export async function fetchBlobWithProgress(
  url: string,
  signal: AbortSignal,
  onBytes: (bytes: ByteCount) => void,
): Promise<Blob> {
  if (signal.aborted) throw abortError(signal);
  const res = await fetch(url, { signal });
  if (signal.aborted) throw abortError(signal);
  if (!res.ok) throw new Error(`Could not download (${res.status})`);
  const parsed = Number(res.headers.get('content-length'));
  const total = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  if (!res.body) {
    const blob = await res.blob();
    onBytes({ loaded: blob.size, total });
    return blob;
  }

  const reader = res.body.getReader();
  let loaded = 0;
  let blob = new Blob();
  let chunks: Uint8Array[] = [];
  let pending = 0;
  const fold = () => {
    blob = new Blob([blob, ...(chunks as unknown as BlobPart[])]);
    chunks = [];
    pending = 0;
  };
  try {
    while (true) {
      if (signal.aborted) throw abortError(signal);
      const { done, value } = await reader.read();
      if (signal.aborted) throw abortError(signal);
      if (done || !value) break;
      loaded += value.byteLength;
      chunks.push(value);
      pending += value.byteLength;
      if (pending >= FOLD_BYTES) fold();
      onBytes({ loaded, total });
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (signal.aborted) throw abortError(signal);
    throw error;
  }
  if (chunks.length > 0) fold();
  if (loaded === 0) onBytes({ loaded: 0, total });
  return blob;
}
