import { describe, expect, it } from 'vitest';
import { detectMemoryBudget } from '../src/core/memoryBudget';
import { planGaussianDecode } from '../src/loaders/gaussian/gaussianPlan';
import { resolvePreset } from '../src/core/qualityPreset';
import { presetConsequence } from '../src/ui/presetConsequence';

const desktop8 = detectMemoryBudget({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
  deviceMemory: 8,
  hardwareConcurrency: 8,
  maxTouchPoints: 0,
});

const mobile4 = detectMemoryBudget({
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  deviceMemory: 4,
  hardwareConcurrency: 4,
});

const scan = {
  sourceCount: 14_161_020,
  retainedCount: 14_161_020,
  sourceSh: 3,
  loadedSh: 3,
};

describe('presetConsequence', () => {
  it('plans the 14,161,020 splat scan at SH 2 for Automatic and SH 1 for Lower memory', () => {
    const autoPlan = resolvePreset('auto', desktop8);
    const memoryPlan = resolvePreset('memory', desktop8);
    const auto = planGaussianDecode({
      sourceCount: scan.sourceCount,
      sourceSh: 3,
      budget: autoPlan.budget,
      preferExtended: true,
      overrides: autoPlan.overrides,
    });
    const memory = planGaussianDecode({
      sourceCount: scan.sourceCount,
      sourceSh: 3,
      budget: memoryPlan.budget,
      preferExtended: true,
      overrides: memoryPlan.overrides,
    });
    expect(auto.shDegree).toBe(2);
    expect(auto.estimatedBytes).toBe(1_073_741_824);
    expect(memory.shDegree).toBe(1);
    expect(memory.estimatedBytes).toBe(805_306_368);

    const loaded = {
      preset: 'auto' as const,
      loadedPreset: 'auto' as const,
      kind: 'splats' as const,
      detail: scan,
      bytes: 2_000_000_000,
      budget: desktop8,
    };
    expect(presetConsequence(loaded)).toBe(
      'This scan: 14,161,020 splats at SH 2 of 3, about 1.07 GB.',
    );
    expect(presetConsequence({ ...loaded, preset: 'memory' })).toBe(
      'This scan: 14,161,020 splats at SH 2 of 3, about 1.07 GB. Reopen to apply: SH 1 of 3, about 805 MB.',
    );
  });

  it('says reopening would not change a scan whose plan matches', () => {
    const text = presetConsequence({
      preset: 'quality',
      loadedPreset: 'auto',
      kind: 'splats',
      detail: scan,
      bytes: 2_000_000_000,
      budget: desktop8,
    });
    expect(text).toContain('Reopening would not change this scan.');
  });

  it('steps a phone down to SH 0 for Lower memory', () => {
    const text = presetConsequence({
      preset: 'memory',
      loadedPreset: 'auto',
      kind: 'splats',
      detail: scan,
      bytes: 2_000_000_000,
      budget: mobile4,
    });
    expect(text).toContain('Reopen to apply: SH 0 of 3');
  });

  it('explains Spark files, meshes, point clouds, and an empty view', () => {
    expect(
      presetConsequence({
        preset: 'auto',
        loadedPreset: 'auto',
        kind: 'splats',
        detail: null,
        budget: desktop8,
      }),
    ).toBe('This file is decoded by Spark, so only the rendered SH and pixel ratio change.');
    expect(
      presetConsequence({
        preset: 'auto',
        loadedPreset: 'auto',
        kind: 'mesh',
        budget: desktop8,
      }),
    ).toBe('Presets only change the pixel ratio for meshes.');
    expect(
      presetConsequence({
        preset: 'auto',
        loadedPreset: 'auto',
        kind: 'points',
        detail: { sourceCount: 24_000, retainedCount: 24_000 },
        budget: desktop8,
      }),
    ).toBe('This point cloud: 24,000 points, all shown.');
    expect(
      presetConsequence({
        preset: 'auto',
        loadedPreset: null,
        kind: null,
        budget: desktop8,
      }),
    ).toBeNull();
  });
});
