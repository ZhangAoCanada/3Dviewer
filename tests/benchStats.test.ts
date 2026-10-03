import { describe, expect, it } from 'vitest';
import {
  BENCH_MARKDOWN_FIELDS,
  formatBenchMarkdown,
  percentile,
  summarizeFrames,
  type BenchReport,
} from '../src/bench/benchStats';

describe('percentile', () => {
  it('uses the nearest rank and returns null for an empty array', () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40, 50], 90)).toBe(50);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 100)).toBe(10);
    expect(percentile([5], 99)).toBe(5);
  });
});

describe('summarizeFrames', () => {
  it('counts frames over 33 ms and leaves an empty run null', () => {
    expect(summarizeFrames([])).toEqual({ count: 0, p50: null, p90: null, p99: null, max: null, over33: 0 });
    const summary = summarizeFrames([10, 40, 33, 34, 20]);
    expect(summary.count).toBe(5);
    expect(summary.over33).toBe(2);
    expect(summary.max).toBe(40);
    expect(summary.p50).toBe(33);
  });
});

describe('formatBenchMarkdown', () => {
  it('has a row for every field', () => {
    const report: BenchReport = {
      schema: 'omniview-bench/1',
      partial: false,
      note: 'Frame times measure render and sort only. Orbiting through restore() skips input handling and inertia.',
      build: 'abc1234',
      userAgent: 'Test',
      platform: 'Linux',
      deviceMemory: 8,
      cores: 4,
      dpr: 1,
      viewport: '1280×800',
      renderer: 'SwiftShader',
      software: true,
      preset: 'auto',
      scene: { name: 'torus.ply', kind: 'splats', bytes: 100, count: 4800, sourceCount: 4800, sh: '3' },
      firstDrawMs: 12,
      readyMs: 40,
      frames: { count: 10, p50: 16, p90: 20, p99: 30, max: 40, over33: 1 },
      renderMs: { count: 8, p50: 4, p90: 6, p99: 9, max: 11, over33: 0 },
      sortSettleMs: 80,
      memory: {
        source: 'performance.memory',
        heapPeak: 1000,
        gpuMemoryBytes: 500,
        userAgentSpecificBytes: null,
        wasm: null,
        wasmReason: 'not exposed by Spark',
      },
      reloads: [
        { firstDrawMs: 10, readyMs: 20, ok: true, heap: 100 },
        { firstDrawMs: 11, readyMs: 21, ok: true, heap: 110 },
        { firstDrawMs: 12, readyMs: 22, ok: true, heap: 120 },
      ],
      heapGrowth: 20,
      camera: {
        before: { position: [1, 2, 3], pivot: [0, 0, 0] },
        after: { position: [1, 2, 3], pivot: [0, 0, 0] },
      },
    };
    const markdown = formatBenchMarkdown(report);
    const labels = [...markdown.matchAll(/^\| ([^|]+) \|/gm)]
      .map((match) => match[1]?.trim() ?? '')
      .filter((label) => label !== 'Field' && label !== '---');
    expect(labels).toEqual([...BENCH_MARKDOWN_FIELDS]);
    expect(markdown).toContain('omniview-bench/1');
    expect(markdown).toContain('not exposed by Spark');
  });
});
