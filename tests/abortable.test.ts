import { describe, expect, it, vi } from 'vitest';
import { raceAbort } from '../src/core/abortable';
import { LoadStalledError } from '../src/core/loadFailure';

function hang<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('raceAbort', () => {
  it('rejects with an AbortError while work is still pending', async () => {
    const controller = new AbortController();
    const work = hang<number>();
    const onLate = vi.fn();
    const raced = raceAbort(work.promise, controller.signal, onLate);
    controller.abort();
    await expect(raced).rejects.toMatchObject({ name: 'AbortError' });
    expect(onLate).not.toHaveBeenCalled();
  });

  it('calls onLate once when work resolves after the abort', async () => {
    const controller = new AbortController();
    const work = hang<string>();
    const onLate = vi.fn();
    const raced = raceAbort(work.promise, controller.signal, onLate);
    controller.abort();
    await expect(raced).rejects.toMatchObject({ name: 'AbortError' });
    work.resolve('late');
    await Promise.resolve();
    await Promise.resolve();
    expect(onLate).toHaveBeenCalledTimes(1);
    expect(onLate).toHaveBeenCalledWith('late');
  });

  it('does not call onLate when work wins', async () => {
    const controller = new AbortController();
    const onLate = vi.fn();
    await expect(raceAbort(Promise.resolve(5), controller.signal, onLate)).resolves.toBe(5);
    expect(onLate).not.toHaveBeenCalled();
  });

  it('surfaces a LoadStalledError reason', async () => {
    const controller = new AbortController();
    const reason = new LoadStalledError('stalled');
    controller.abort(reason);
    const onLate = vi.fn();
    await expect(raceAbort(hang<number>().promise, controller.signal, onLate)).rejects.toBe(reason);
    expect(onLate).not.toHaveBeenCalled();
  });

  it('swallows a late rejection', async () => {
    const errors: unknown[] = [];
    const onUnhandled = (error: unknown) => {
      errors.push(error);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const controller = new AbortController();
      const work = hang<number>();
      const raced = raceAbort(work.promise, controller.signal, () => {});
      controller.abort();
      await expect(raced).rejects.toMatchObject({ name: 'AbortError' });
      work.reject(new Error('late'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(errors).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
