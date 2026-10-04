import type { RepresentationKind } from '../core/types';

export interface ControlRule {
  applies?: string[];
  scene?: boolean;
  preload?: boolean;
}

/**
 * Whether a control can be used.
 * With no scene, scene and kind-specific controls are off unless they configure the next load.
 * With a scene, a kind-specific control is hidden when none of its kinds are loaded.
 */
export function controlState(kinds: ReadonlySet<RepresentationKind>, rule: ControlRule): 'on' | 'off' | 'hidden' {
  if (kinds.size === 0) {
    if (rule.preload) return 'on';
    if (rule.scene || rule.applies !== undefined) return 'off';
    return 'on';
  }
  if (rule.applies !== undefined && !rule.applies.some((kind) => isKind(kind) && kinds.has(kind))) return 'hidden';
  return 'on';
}

function isKind(value: string): value is RepresentationKind {
  return value === 'splats' || value === 'mesh' || value === 'points' || value === 'voxels';
}
