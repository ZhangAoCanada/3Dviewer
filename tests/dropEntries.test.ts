import { describe, expect, it } from 'vitest';
import { collectDropped, type DropEntry } from '../src/ui/dropEntries';

function fileEntry(path: string): DropEntry {
  const name = path.split('/').pop() ?? path;
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath: `/${path}`,
    file: async () => new File([name], name),
    createReader: () => ({ readEntries: async () => [] }),
  };
}

function batchDir(path: string, batches: readonly (readonly DropEntry[])[]): { entry: DropEntry; calls: () => number } {
  let calls = 0;
  const name = path.split('/').pop() ?? path;
  const entry: DropEntry = {
    isFile: false,
    isDirectory: true,
    name,
    fullPath: `/${path}`,
    file: async () => {
      throw new Error('directory');
    },
    createReader: () => ({
      readEntries: async () => {
        const batch = batches[calls] ?? [];
        calls += 1;
        return batch;
      },
    }),
  };
  return { entry, calls: () => calls };
}

describe('collectDropped', () => {
  it('reads directory batches of 100 until an empty one', async () => {
    const files = Array.from({ length: 100 }, (_, index) => fileEntry(`drop/f${index}.bin`));
    const root = batchDir('drop', [files, []]);
    const collected = await collectDropped([root.entry]);
    expect(collected).toHaveLength(100);
    expect(collected[0]?.path).toBe('drop/f0.bin');
    expect(root.calls()).toBe(2);
  });

  it('walks nested folders', async () => {
    const sub = batchDir('root/sub', [[fileEntry('root/sub/a.obj')], []]);
    const root = batchDir('root', [[sub.entry, fileEntry('root/b.mtl')], []]);
    const collected = await collectDropped([root.entry]);
    expect(collected.map((file) => file.path).sort()).toEqual(['root/b.mtl', 'root/sub/a.obj']);
  });

  it('caps depth at 8 and the file count at 2,000', async () => {
    const tooDeep = fileEntry('root/d1/d2/d3/d4/d5/d6/d7/d8/too-deep.txt');
    const deep = batchDir('root/d1/d2/d3/d4/d5/d6/d7/d8', [[tooDeep], []]);
    let node = batchDir('root/d1/d2/d3/d4/d5/d6/d7', [
      [fileEntry('root/d1/d2/d3/d4/d5/d6/d7/kept.txt'), deep.entry],
      [],
    ]);
    for (const name of ['d6', 'd5', 'd4', 'd3', 'd2', 'd1']) {
      node = batchDir(`wrap-${name}`, [[node.entry], []]);
    }
    const root = batchDir('root', [[node.entry], []]);
    const collected = await collectDropped([root.entry]);
    expect(collected.map((file) => file.file.name)).toContain('kept.txt');
    expect(collected.map((file) => file.file.name)).not.toContain('too-deep.txt');
    expect(deep.calls()).toBe(0);

    let n = 0;
    const wide = batchDir('wide', [
      ...Array.from({ length: 21 }, () =>
        Array.from({ length: 100 }, () => {
          const file = fileEntry(`wide/f${n}.bin`);
          n += 1;
          return file;
        }),
      ),
      [],
    ]);
    expect(await collectDropped([wide.entry])).toHaveLength(2000);
  });
});