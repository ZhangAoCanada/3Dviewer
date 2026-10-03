import type { CompanionFile } from '../core/types';

/** One level of a dropped folder. `readEntries` returns one batch, then `[]`. */
export interface DropReader {
  readEntries(): Promise<readonly DropEntry[]>;
}

export interface DropEntry {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly name: string;
  readonly fullPath: string;
  file(): Promise<File>;
  createReader(): DropReader;
}

const MAX_DEPTH = 8;
const MAX_FILES = 2000;

interface DomEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
  file?: (success: (file: File) => void, error?: (err: DOMException) => void) => void;
  createReader?: () => {
    readEntries: (success: (entries: DomEntry[]) => void, error?: (err: DOMException) => void) => void;
  };
}

/** Adapt a `webkitGetAsEntry()` result. Callers must obtain the entry synchronously. */
export function toDropEntry(entry: DomEntry): DropEntry {
  return {
    isFile: entry.isFile,
    isDirectory: entry.isDirectory,
    name: entry.name,
    fullPath: entry.fullPath,
    file: () =>
      new Promise((resolve, reject) => {
        if (!entry.file) {
          reject(new DOMException('Not a file', 'NotFoundError'));
          return;
        }
        entry.file(resolve, reject);
      }),
    createReader: () => {
      const reader = entry.createReader?.();
      return {
        readEntries: () =>
          new Promise<readonly DropEntry[]>((resolve, reject) => {
            if (!reader) {
              resolve([]);
              return;
            }
            reader.readEntries((entries) => resolve(entries.map(toDropEntry)), reject);
          }),
      };
    },
  };
}

function relativePath(fullPath: string): string {
  return fullPath.replace(/^\/+/, '');
}

/**
 * Flatten a drop into companion files.
 * Directory readers are polled until an empty batch. Depth stops at 8 and the
 * file count at 2,000, counting the dropped items as depth 0.
 */
export async function collectDropped(entries: readonly DropEntry[]): Promise<CompanionFile[]> {
  const out: CompanionFile[] = [];
  await walk(entries, 0, out);
  return out;
}

async function walk(entries: readonly DropEntry[], depth: number, out: CompanionFile[]): Promise<void> {
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    if (entry.isFile) {
      const file = await entry.file();
      out.push({ path: relativePath(entry.fullPath) || file.name, file });
      continue;
    }
    if (!entry.isDirectory || depth >= MAX_DEPTH) continue;
    const reader = entry.createReader();
    for (;;) {
      if (out.length >= MAX_FILES) return;
      const batch = await reader.readEntries();
      if (batch.length === 0) break;
      await walk(batch, depth + 1, out);
    }
  }
}
