import { describe, expect, it } from 'vitest';
import { LoaderRegistry } from '../src/core/registry';
import type { AssetSource, FormatLoader, Renderable } from '../src/core/types';

function loader(partial: Pick<FormatLoader, 'id' | 'priority' | 'extensions' | 'sniff'>): FormatLoader {
  return {
    label: partial.id,
    kind: 'mesh',
    load: async () => ({}) as Renderable,
    ...partial,
  };
}

describe('LoaderRegistry', () => {
  it('returns the highest priority claim', () => {
    const registry = new LoaderRegistry();
    const low = loader({
      id: 'low',
      priority: 1,
      extensions: ['ply'],
      sniff: () => true,
    });
    const high = loader({
      id: 'high',
      priority: 5,
      extensions: ['ply'],
      sniff: () => true,
    });
    registry.register(low);
    registry.register(high);
    const source: AssetSource = { name: 'a.ply', extension: 'ply', origin: 'file' };
    expect(registry.resolve(source, new Uint8Array())?.id).toBe('high');
    expect(registry.extensions()).toEqual(['ply']);
  });

  it('skips loaders that abstain', () => {
    const registry = new LoaderRegistry();
    registry.register(
      loader({
        id: 'skip',
        priority: 9,
        extensions: ['obj'],
        sniff: () => undefined,
      }),
    );
    registry.register(
      loader({
        id: 'take',
        priority: 1,
        extensions: ['obj'],
        sniff: (source) => (source.extension === 'obj' ? true : undefined),
      }),
    );
    const source: AssetSource = { name: 'mesh.obj', extension: 'obj', origin: 'file' };
    expect(registry.resolve(source, new Uint8Array())?.id).toBe('take');
  });
});
