import { describe, expect, it } from 'vitest';
import { formatCompact } from '../src/ui/format';

describe('formatCompact', () => {
  it('formats the HUD examples', () => {
    expect(formatCompact(999)).toBe('999');
    expect(formatCompact(4800)).toBe('4.8K');
    expect(formatCompact(14_000_000)).toBe('14.0M');
    expect(formatCompact(3_500_000)).toBe('3.50M');
  });

  it('returns an em dash for non-finite values', () => {
    expect(formatCompact(Number.NaN)).toBe('—');
    expect(formatCompact(Number.POSITIVE_INFINITY)).toBe('—');
  });
});