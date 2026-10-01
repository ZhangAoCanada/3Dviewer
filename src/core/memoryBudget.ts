import type { MemoryBudget } from './types';

export interface BudgetHints {
  userAgent?: string;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  maxTouchPoints?: number;
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
  const touch =
    hints.maxTouchPoints ?? (typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0);
  // iPadOS reports a desktop Macintosh UA. More than one touch point marks it as a tablet.
  const iPadDesktop = /Macintosh/i.test(ua) && touch > 1;
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(ua) || iPadDesktop;
  const lowRam = deviceMemory !== undefined && deviceMemory <= 4;
  const mobile = mobileUa || lowRam || (cores !== undefined && cores <= 4 && mobileUa);

  if (mobile) {
    const gb = deviceMemory ?? 4;
    const cpuMb = Math.min(384, Math.max(160, gb * 48));
    return {
      profile: 'mobile',
      cpuBytes: Math.round(cpuMb * 1024 * 1024),
      maxPoints: 1_500_000,
      maxSplatsResident: gb <= 4 ? 700_000 : 900_000,
      maxSh: 1,
      pixelRatioCap: 1.5,
    };
  }
  // Chrome caps deviceMemory at 8. Leave headroom for the tab, the GPU upload, and the sort worker.
  const gb = deviceMemory ?? 8;
  const cpuBytes = Math.round(Math.min(2.25, Math.max(0.75, gb * 0.22)) * 1024 * 1024 * 1024);
  return {
    profile: 'desktop',
    cpuBytes,
    maxPoints: 8_000_000,
    maxSplatsResident: gb <= 4 ? 1_500_000 : 2_500_000,
    maxSh: 3,
    pixelRatioCap: 2,
  };
}
