import { describe, expect, it } from 'vitest';
import { detectMemoryBudget } from '../src/core/memoryBudget';

describe('detectMemoryBudget', () => {
  it('uses a smaller budget on phones', () => {
    const mobile = detectMemoryBudget({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    const desktop = detectMemoryBudget({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
      deviceMemory: 16,
      hardwareConcurrency: 8,
    });
    expect(mobile.profile).toBe('mobile');
    expect(desktop.profile).toBe('desktop');
    expect(mobile.maxPoints).toBeLessThan(desktop.maxPoints);
    expect(mobile.maxSplatsResident).toBeLessThan(desktop.maxSplatsResident);
    expect(mobile.cpuBytes).toBeGreaterThan(0);
  });
});
