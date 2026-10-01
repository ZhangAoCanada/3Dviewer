/**
 * WASM traps surface as RuntimeError with message "unreachable".
 * Never show that string on its own.
 */
export function explainLoadError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'Loading stopped.';
  }
  const message = error instanceof Error ? error.message.trim() : String(error).trim();
  const name = error instanceof Error ? error.name : '';
  const wasm =
    name === 'RuntimeError' ||
    /unreachable|memory access out of bounds|out of memory|allocation failed|Array buffer allocation failed/i.test(
      message,
    );
  if (wasm) {
    const detail = message && message !== 'unreachable' ? ` (${message})` : '';
    return `The splat decoder hit a WebAssembly fault${detail}. That usually means the file was larger than the WASM heap, or a PLY header count did not match the body. Standard Gaussian PLY is decoded in chunks outside WASM. If this was a compressed file (.spz, .sog, .rad), try a machine with more memory, or convert the scene to a paged .rad and open that instead.`;
  }
  return message || 'Could not load the file.';
}
