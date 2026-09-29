import type { MemoryBudget } from './types';

export interface BudgetHints {
  userAgent?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

/**
 * Coarse device profile. Octree/RAD paging should treat these as soft caps,
 * not as a reason to refuse a file.
 */
export function detectMemoryBudget(hints: BudgetHints = {}): MemoryBudget {
  const ua = hints.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  const deviceMemory =
    hints.deviceMemory ??
    (typeof navigator !== 'undefined'
      ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory
      : undefined);
  const cores = hints.hardwareConcurrency ?? (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 8);
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua);
  const lowRam = deviceMemory !== undefined && deviceMemory <= 4;
  const mobile = mobileUa || lowRam || (cores !== undefined && cores <= 4 && mobileUa);

  if (mobile) {
    return {
      profile: 'mobile',
      cpuBytes: 256 * 1024 * 1024,
      maxPoints: 1_500_000,
      maxSplatsResident: 900_000,
      maxSh: 1,
      pixelRatioCap: 1.5,
    };
  }
  return {
    profile: 'desktop',
    cpuBytes: 1024 * 1024 * 1024,
    maxPoints: 8_000_000,
    maxSplatsResident: 2_500_000,
    maxSh: 3,
    pixelRatioCap: 2,
  };
}
