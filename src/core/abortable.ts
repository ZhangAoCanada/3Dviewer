/** Turn `signal.reason` into the error loaders should throw. */
export function abortReason(signal: AbortSignal): Error {
  const reason = signal.reason;
  if (reason instanceof Error && reason.name !== 'AbortError') return reason;
  return new DOMException('Load aborted', 'AbortError');
}

/**
 * Settles with `work`, or rejects as soon as `signal` aborts.
 * A value that arrives after the abort is handed to `onLate` once.
 * A rejection that arrives after the abort is swallowed.
 */
export function raceAbort<T>(work: Promise<T>, signal: AbortSignal, onLate: (value: T) => void): Promise<T> {
  if (signal.aborted) {
    void work.then(
      (value) => onLate(value),
      () => undefined,
    );
    return Promise.reject(abortReason(signal));
  }
  let settled = false;
  return new Promise<T>((resolve, reject) => {
    const fail = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', fail);
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', fail);
    work.then(
      (value) => {
        if (settled) {
          onLate(value);
          return;
        }
        settled = true;
        signal.removeEventListener('abort', fail);
        resolve(value);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', fail);
        reject(error);
      },
    );
  });
}
