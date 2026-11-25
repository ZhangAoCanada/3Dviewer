/** Consume bounded work units, returning to the event loop between slices.
 * The elapsed target is cooperative, not a guaranteed maximum (GC/OS scheduling may exceed it).
 */
export async function runCooperatively(work: Generator<void, void, unknown>, signal: AbortSignal,
  yieldTask: () => Promise<void> = () => new Promise(resolve => globalThis.setTimeout(resolve, 0))): Promise<void> {
  try {
    for (;;) {
      signal.throwIfAborted();
      const start = performance.now();
      let complete = false;
      for (let units = 0; units < 2048; units++) {
        if (work.next().done) { complete = true; break; }
        if (units % 64 === 63 && performance.now() - start >= 4) break;
      }
      signal.throwIfAborted();
      if (complete) return;
      await yieldTask();
    }
  } finally { work.return(); }
}
