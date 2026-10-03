import { describe, expect, it } from 'vitest';
import { GaussianPlyError } from '../src/loaders/gaussian/decodeGaussianPly';
import {
  classifyFailure,
  GraphicsUnavailableError,
  LoadStalledError,
  type FailureAction,
  type FailureKind,
} from '../src/core/loadFailure';

const cases: { name: string; error: unknown; kind: FailureKind; actions: FailureAction[] }[] = [
  {
    name: 'Chrome failed to fetch',
    error: new TypeError('Failed to fetch'),
    kind: 'network',
    actions: ['retry', 'open-file'],
  },
  {
    name: 'Firefox network error',
    error: new TypeError('NetworkError when attempting to fetch resource.'),
    kind: 'network',
    actions: ['retry', 'open-file'],
  },
  {
    name: 'Safari load failed',
    error: new TypeError('Load failed'),
    kind: 'network',
    actions: ['retry', 'open-file'],
  },
  {
    name: 'download 404',
    error: new Error('Could not download x.ply (404)'),
    kind: 'network',
    actions: ['retry', 'open-file'],
  },
  {
    name: 'array buffer allocation',
    error: new RangeError('Array buffer allocation failed'),
    kind: 'memory',
    actions: ['retry-lower-memory', 'download-app'],
  },
  {
    name: 'wasm unreachable',
    error: Object.assign(new Error('unreachable'), { name: 'RuntimeError' }),
    kind: 'memory',
    actions: ['retry-lower-memory', 'download-app'],
  },
  {
    name: 'gaussian ply',
    error: new GaussianPlyError('PLY header is missing end_header.'),
    kind: 'format',
    actions: ['choose-file', 'formats'],
  },
  {
    name: 'wrapped range error',
    error: new Error('decoder failed', { cause: new RangeError('Array buffer allocation failed') }),
    kind: 'memory',
    actions: ['retry-lower-memory', 'download-app'],
  },
  {
    name: 'stall',
    error: new LoadStalledError(
      'Loading stalled: no progress for 90 s. The file is still on disk; try again, or convert it to a paged .rad so the next open does not read the whole PLY.',
    ),
    kind: 'stalled',
    actions: ['retry'],
  },
  {
    name: 'graphics',
    error: new GraphicsUnavailableError('no-webgl2', 'WebGL2 is required. This browser cannot create a WebGL2 context.'),
    kind: 'graphics',
    actions: ['reinit-graphics', 'download-app'],
  },
  {
    name: 'abort',
    error: new DOMException('Loading cancelled', 'AbortError'),
    kind: 'cancelled',
    actions: [],
  },
];

describe('classifyFailure', () => {
  it.each(cases)('$name → $kind', ({ error, kind, actions }) => {
    const failure = classifyFailure(error);
    expect(failure.kind).toBe(kind);
    expect(failure.actions).toEqual(actions);
  });

  it('keeps the .rad hint on a stall', () => {
    const failure = classifyFailure(
      new LoadStalledError('Loading stalled: no progress for 90 s. Convert it to a paged .rad.'),
    );
    expect(failure.body).toContain('.rad');
    expect(failure.title).toBe('Loading stopped responding');
  });

  it('treats a parse-stage error as a format problem', () => {
    const failure = classifyFailure(new Error('decoder gave up'), { stage: 'parse' });
    expect(failure.kind).toBe('format');
    expect(failure.actions).toEqual(['choose-file', 'formats']);
  });

  it('names graphics and format cards', () => {
    expect(classifyFailure(new GraphicsUnavailableError('no-webgl2', 'no')).title).toBe('Graphics are not available');
    expect(classifyFailure(new GaussianPlyError('bad')).title).toBe('This file could not be read');
    expect(classifyFailure(new Error('Could not download x.ply (404)')).title).toBe('Could not download the file');
    expect(classifyFailure(new RangeError('Invalid array length')).title).toBe('Not enough memory for this scene');
  });
});
