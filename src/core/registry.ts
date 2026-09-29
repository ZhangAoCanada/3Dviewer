import type { AssetSource, FormatLoader } from './types';

/**
 * Process-wide loader registry. Format agents register here and nowhere else
 * needs to change to accept a new extension.
 */
export class LoaderRegistry {
  private readonly loaders: FormatLoader[] = [];

  register(loader: FormatLoader): void {
    const existing = this.loaders.findIndex((item) => item.id === loader.id);
    if (existing >= 0) this.loaders.splice(existing, 1);
    this.loaders.push(loader);
  }

  list(): readonly FormatLoader[] {
    return [...this.loaders].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }

  extensions(): string[] {
    const set = new Set<string>();
    for (const loader of this.loaders) {
      for (const ext of loader.extensions) set.add(ext);
    }
    return [...set].sort();
  }

  resolve(source: AssetSource, header: Uint8Array): FormatLoader | null {
    const ranked = this.list();
    for (const loader of ranked) {
      const verdict = loader.sniff(source, header);
      if (verdict === true) return loader;
    }
    return null;
  }
}
