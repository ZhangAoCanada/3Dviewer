import type { MemoryBudget, RenderSettings } from '../core/types';

/**
 * Spark multiplies `lodSplatCount * lodSplatScale`, and each mesh `lodScale`
 * multiplies again. Keep the count at the resident budget and the mesh scale at 1
 * so the slider applies once.
 */
export function lodParams(
  budget: MemoryBudget,
  settings: Pick<RenderSettings, 'lodSplatScale'>,
): { lodSplatCount: number; lodSplatScale: number } {
  return {
    lodSplatCount: budget.maxSplatsResident,
    lodSplatScale: settings.lodSplatScale,
  };
}
