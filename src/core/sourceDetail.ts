import type { ShReductionReason } from './types';

/** A declined full-detail request is not permission to silently load a reduced scene. */
export class FullSourceDetailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FullSourceDetailError';
  }
}

/** Reason recorded by decode, never inferred from the selected UI preset or GPU model. */
export function shReductionText(loaded: number, source: number, reason?: ShReductionReason): string {
  const base = `SH ${loaded} of ${source} loaded`;
  if (source > 3) {
    const further = reason === 'request' ? ', with a further requested load cap' : reason === 'budget' ? ', with further memory-budget reduction' : ', with further load-policy reduction';
    return `${base}; renderer supports up to SH 3${loaded < 3 ? further : ''}`;
  }
  return reason === 'request' ? `${base} (requested load cap)` : reason === 'budget' ? `${base} (memory budget)` : base;
}
