import { describe, expect, it } from 'vitest';
import type { RepresentationKind } from '../src/core/types';
import { controlState, type ControlRule } from '../src/ui/applicability';

const none = new Set<RepresentationKind>();
const splats = new Set<RepresentationKind>(['splats']);
const mesh = new Set<RepresentationKind>(['mesh']);
const points = new Set<RepresentationKind>(['points']);
const mixed = new Set<RepresentationKind>(['splats', 'mesh']);

describe('controlState', () => {
  it.each<[string, ReadonlySet<RepresentationKind>, ControlRule, 'on' | 'off' | 'hidden']>([
    ['no scene, unmarked', none, {}, 'on'],
    ['no scene, scene control', none, { scene: true }, 'off'],
    ['no scene, applies', none, { applies: ['points'] }, 'off'],
    ['no scene, preload applies', none, { applies: ['splats'], preload: true }, 'on'],
    ['no scene, preload scene', none, { scene: true, preload: true }, 'on'],
    ['splats, scene control', splats, { scene: true }, 'on'],
    ['splats, splat control', splats, { applies: ['splats'] }, 'on'],
    ['splats, point control', splats, { applies: ['points'] }, 'hidden'],
    ['splats, mesh control', splats, { applies: ['mesh'] }, 'hidden'],
    ['splats, preload splat control', splats, { applies: ['splats'], preload: true }, 'on'],
    ['splats, unmarked', splats, {}, 'on'],
    ['mesh, point control', mesh, { applies: ['points'] }, 'hidden'],
    ['mesh, mesh control', mesh, { applies: ['mesh'] }, 'on'],
    ['mesh, preload splat control', mesh, { applies: ['splats'], preload: true }, 'hidden'],
    ['mesh, scene control', mesh, { scene: true }, 'on'],
    ['points, point control', points, { applies: ['points'] }, 'on'],
    ['points, splat control', points, { applies: ['splats'] }, 'hidden'],
    ['mixed, splat control', mixed, { applies: ['splats'] }, 'on'],
    ['mixed, mesh control', mixed, { applies: ['mesh'] }, 'on'],
    ['mixed, point control', mixed, { applies: ['points'] }, 'hidden'],
    ['mixed, splat or point', mixed, { applies: ['splats', 'points'] }, 'on'],
    ['mesh, empty applies', mesh, { applies: [] }, 'hidden'],
    ['no scene, empty applies', none, { applies: [] }, 'off'],
  ])('%s', (_name, kinds, rule, expected) => {
    expect(controlState(kinds, rule)).toBe(expected);
  });
});
