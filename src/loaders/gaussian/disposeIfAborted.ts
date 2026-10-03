import { abortReason } from '../../core/abortable';

/** Drop a mesh that lost the race with abort, then surface the abort. */
export function disposeIfAborted(mesh: { dispose(): void }, signal: AbortSignal): void {
  if (!signal.aborted) return;
  mesh.dispose();
  throwIfAborted(signal);
}

export function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw abortReason(signal);
}
