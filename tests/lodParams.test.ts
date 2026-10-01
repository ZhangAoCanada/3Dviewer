import { describe, expect, it } from 'vitest';
import type { MemoryBudget } from '../src/core/types';
import { lodParams } from '../src/render/lodParams';

const budget: MemoryBudget = {
  profile: 'desktop',
  cpuBytes: 1024,
  maxPoints: 1,
  maxSplatsResident: 2_500_000,
  maxSh: 3,
  pixelRatioCap: 2,
};

describe('lodParams', () => {
  it('applies the slider once to the resident budget', () => {
    for (const scale of [0.35, 1, 2]) {
      const params = lodParams(budget, { lodSplatScale: scale });
      expect(params.lodSplatCount).toBe(budget.maxSplatsResident);
      expect(params.lodSplatScale).toBe(scale);
      expect(params.lodSplatCount * params.lodSplatScale).toBe(budget.maxSplatsResident * scale);
    }
  });
});
