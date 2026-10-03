import { describe, expect, it } from 'vitest';
import type { RenderableStats, SceneDetail } from '../src/core/types';
import { detailOf, detailSceneText, detailText } from '../src/ui/sceneDetail';

const samePixel = { used: 2, automatic: 2 };

function splats(detail: SceneDetail, primitives = detail.retainedCount): RenderableStats {
  return { kind: 'splats', label: 'scan', primitives, detail };
}

function points(detail: SceneDetail): RenderableStats {
  return { kind: 'points', label: 'cloud', primitives: detail.retainedCount, detail };
}

describe('detailOf', () => {
  it('reports a full scene with no reasons', () => {
    const state = detailOf([splats({ sourceCount: 4800, retainedCount: 4800, sourceSh: 3, loadedSh: 3 })], 3, samePixel);
    expect(state.reduced).toBe(false);
    expect(state.reasons).toEqual([]);
    expect(state.retained).toBe(4800);
    expect(state.source).toBe(4800);
    expect(state.activeSh).toBe(3);
    expect(state.sourceSh).toBe(3);
    expect(detailText(state)).toBe('');
    expect(detailSceneText(state)).toBe('Full');
  });

  it('describes a decode stride', () => {
    const state = detailOf(
      [splats({ sourceCount: 14_161_020, retainedCount: 674_335, sourceSh: 3, loadedSh: 3 })],
      3,
      samePixel,
    );
    expect(state.reduced).toBe(true);
    expect(state.reasons).toEqual(['Showing 674,335 of 14,161,020 splats']);
    expect(detailText(state)).toBe('Showing 674,335 of 14,161,020 splats');
  });

  it('describes an SH cap at decode', () => {
    const state = detailOf(
      [splats({ sourceCount: 14_161_020, retainedCount: 14_161_020, sourceSh: 3, loadedSh: 1 })],
      1,
      samePixel,
    );
    expect(state.reasons).toEqual(['SH 1 of 3 loaded to fit memory']);
    expect(state.activeSh).toBe(1);
    expect(detailSceneText(state)).toBe('Reduced: SH 1 of 3');
  });

  it('describes an SH cap at render', () => {
    const state = detailOf(
      [splats({ sourceCount: 4800, retainedCount: 4800, sourceSh: 3, loadedSh: 3 })],
      0,
      samePixel,
    );
    expect(state.reasons).toEqual(['Rendering SH 0 (set in Settings)']);
    expect(state.activeSh).toBe(0);
    expect(detailText(state)).toBe('Rendering SH 0 (set in Settings)');
    expect(detailSceneText(state)).toBe('Reduced: Rendering SH 0 (set in Settings)');
  });

  it('describes half-float centers', () => {
    const state = detailOf(
      [splats({ sourceCount: 100, retainedCount: 100, sourceSh: 3, loadedSh: 3, precisionReduced: true })],
      3,
      samePixel,
    );
    expect(state.reasons).toEqual(['Half-float centers to fit memory']);
    expect(detailSceneText(state)).toBe('Reduced: Half-float centers to fit memory');
  });

  it('describes a pixel ratio below Automatic', () => {
    const state = detailOf(
      [splats({ sourceCount: 100, retainedCount: 100, sourceSh: 3, loadedSh: 3 })],
      3,
      { used: 1, automatic: 2 },
    );
    expect(state.reasons).toEqual(['Pixel ratio 1 instead of 2']);
    const fractional = detailOf(
      [splats({ sourceCount: 100, retainedCount: 100, sourceSh: 3, loadedSh: 3 })],
      3,
      { used: 1.5, automatic: 2 },
    );
    expect(fractional.reasons).toEqual(['Pixel ratio 1.5 instead of 2']);
  });

  it('ignores a pixel ratio that is not below Automatic', () => {
    const state = detailOf(
      [splats({ sourceCount: 100, retainedCount: 100, sourceSh: 3, loadedSh: 3 })],
      3,
      { used: 2, automatic: 1 },
    );
    expect(state.reduced).toBe(false);
  });

  it('describes a point stride as points', () => {
    const state = detailOf([points({ sourceCount: 24_000, retainedCount: 1_000 })], 3, samePixel);
    expect(state.reasons).toEqual(['Showing 1,000 of 24,000 points']);
    expect(state.activeSh).toBeUndefined();
    expect(state.sourceSh).toBeUndefined();
    expect(detailSceneText(state)).toBe('Reduced: 1,000 of 24,000 points');
  });

  it('does not reduce a Spark item that has no detail', () => {
    const state = detailOf([{ kind: 'splats', label: 'spark', primitives: 100 }], 0, { used: 1, automatic: 2 });
    expect(state.reduced).toBe(false);
    expect(state.reasons).toEqual([]);
    expect(detailSceneText(state)).toBe('Full');
  });

  it('sums counts and takes the minimum SH across items', () => {
    const state = detailOf(
      [
        splats({ sourceCount: 14_161_020, retainedCount: 674_335, sourceSh: 3, loadedSh: 2 }),
        splats({ sourceCount: 100, retainedCount: 100, sourceSh: 3, loadedSh: 1, precisionReduced: true }),
      ],
      0,
      { used: 1, automatic: 2 },
    );
    expect(state.retained).toBe(674_435);
    expect(state.source).toBe(14_161_120);
    expect(state.activeSh).toBe(0);
    expect(state.sourceSh).toBe(3);
    expect(state.reasons).toEqual([
      'Showing 674,435 of 14,161,120 splats',
      'SH 1 of 3 loaded to fit memory',
      'Rendering SH 0 (set in Settings)',
      'Half-float centers to fit memory',
      'Pixel ratio 1 instead of 2',
    ]);
    expect(detailText(state)).toBe(state.reasons.join(' · '));
    expect(detailSceneText(state)).toBe(
      'Reduced: 674,435 of 14,161,120 splats · SH 1 of 3 · Rendering SH 0 (set in Settings) · Half-float centers to fit memory · Pixel ratio 1 instead of 2',
    );
  });

  it('matches the scene row example for a subsampled SH cap', () => {
    const state = detailOf(
      [splats({ sourceCount: 14_161_020, retainedCount: 674_335, sourceSh: 3, loadedSh: 1 })],
      1,
      samePixel,
    );
    expect(detailText(state)).toBe(
      'Showing 674,335 of 14,161,020 splats · SH 1 of 3 loaded to fit memory',
    );
    expect(detailSceneText(state)).toBe('Reduced: 674,335 of 14,161,020 splats · SH 1 of 3');
  });
});
