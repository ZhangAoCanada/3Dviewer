import { describe, expect, it } from 'vitest';
import { detectMemoryBudget } from '../src/core/memoryBudget';
import { mergePresetOverrides, parseQualityPreset, resolvePreset } from '../src/core/qualityPreset';
import { planGaussianDecode } from '../src/loaders/gaussian/gaussianPlan';

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

describe('resolvePreset', () => {
  it('returns the desktop budget unchanged for Automatic', () => {
    const plan = resolvePreset('auto', desktop8);
    expect(plan.budget).toBe(desktop8);
    expect(plan.overrides).toBeUndefined();
    expect(plan.renderSh).toBe(desktop8.maxSh);
    expect(plan.pixelRatio).toBe('auto');
    expect(plan.extendedPrecision).toBe(false);
    expect(plan.alwaysPreClear).toBe(false);
    expect(plan.summary).toContain('Desktop · up to SH 3 · level of detail off');
  });

  it('plans the 14,161,020 splat SH3 scan the same way Automatic does today', () => {
    const count = 14_161_020;
    const planned = (preset: 'auto' | 'quality' | 'memory', budget = desktop8) => {
      const plan = resolvePreset(preset, budget);
      return planGaussianDecode({
        sourceCount: count,
        sourceSh: 3,
        budget: plan.budget,
        preferExtended: true,
        overrides: plan.overrides,
      });
    };

    const auto = planned('auto');
    const quality = planned('quality');
    expect(auto.extended).toBe(true);
    expect(auto.shDegree).toBe(2);
    expect(auto.estimatedBytes).toBe(1_073_741_824);
    expect(auto.stride).toBe(1);
    expect(quality.extended).toBe(true);
    expect(quality.shDegree).toBe(2);
    expect(quality.estimatedBytes).toBe(1_073_741_824);
    expect(quality.stride).toBe(1);

    const memory = planned('memory');
    expect(memory.extended).toBe(true);
    expect(memory.shDegree).toBe(1);
    expect(memory.estimatedBytes).toBe(805_306_368);
    expect(memory.stride).toBe(1);

    const mobileAuto = planned('auto', mobile4);
    const mobileMemory = planned('memory', mobile4);
    expect(mobileMemory.shDegree).toBe(0);
    expect(mobileMemory.decodedCount).toBeLessThanOrEqual(mobileAuto.decodedCount);
  });

  it('keeps level of detail off for every preset unless lod=force, and never builds it for Lower memory', () => {
    for (const preset of ['auto', 'quality', 'memory'] as const) {
      const plan = resolvePreset(preset, desktop8);
      const decoded = planGaussianDecode({
        sourceCount: 14_161_020,
        sourceSh: 3,
        budget: plan.budget,
        preferExtended: true,
        overrides: plan.overrides,
      });
      expect(decoded.lod).toBe(false);
      expect(plan.overrides?.forceLod).toBeUndefined();
    }

    const memory = resolvePreset('memory', desktop8);
    const merged = mergePresetOverrides('memory', memory, { forceLod: true, maxSh: 2 });
    expect(merged?.forceLod).toBeUndefined();
    expect(merged?.maxSh).toBe(2);
    const forced = planGaussianDecode({
      sourceCount: 14_161_020,
      sourceSh: 3,
      budget: memory.budget,
      preferExtended: true,
      overrides: merged,
    });
    expect(forced.lod).toBe(false);

    const automatic = resolvePreset('auto', desktop8);
    expect(mergePresetOverrides('auto', automatic, { forceLod: true })?.forceLod).toBe(true);
  });

  it('parses an invalid stored string as Automatic', () => {
    expect(parseQualityPreset(null)).toBe('auto');
    expect(parseQualityPreset(undefined)).toBe('auto');
    expect(parseQualityPreset('')).toBe('auto');
    expect(parseQualityPreset('AUTO')).toBe('auto');
    expect(parseQualityPreset('high')).toBe('auto');
    expect(parseQualityPreset('quality')).toBe('quality');
    expect(parseQualityPreset('memory')).toBe('memory');
  });
});
