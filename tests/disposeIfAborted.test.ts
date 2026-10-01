import { describe, expect, it, vi } from 'vitest';
import { disposeIfAborted } from '../src/loaders/gaussian/disposeIfAborted';

describe('disposeIfAborted', () => {
  it('disposes a mesh whose initialized resolves after abort', async () => {
    const abort = new AbortController();
    let resolveInitialized: () => void = () => {};
    const mesh = {
      dispose: vi.fn(),
      initialized: new Promise<void>((resolve) => {
        resolveInitialized = resolve;
      }),
    };
    const finished = (async () => {
      await mesh.initialized;
      disposeIfAborted(mesh, abort.signal);
    })();
    abort.abort();
    resolveInitialized();
    await expect(finished).rejects.toMatchObject({ name: 'AbortError' });
    expect(mesh.dispose).toHaveBeenCalledOnce();
  });

  it('leaves a mesh that was not aborted', () => {
    const abort = new AbortController();
    const mesh = { dispose: vi.fn() };
    disposeIfAborted(mesh, abort.signal);
    expect(mesh.dispose).not.toHaveBeenCalled();
  });
});
