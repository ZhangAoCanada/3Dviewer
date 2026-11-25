import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GAME_KEY_BINDINGS,
  GAME_ACTIONS,
  KEY_BINDINGS_VERSION,
  MAX_PERSISTED_JSON_LENGTH,
  RESERVED_RECOVERY_CODE,
  getActionForCode,
  isActionActive,
  isAssignableCode,
  isBoundCode,
  isCodeBoundToAction,
  isReservedRecoveryCode,
  parseKeyBindingsJson,
  rebindAction,
  serializeKeyBindings,
  validateKeyBindings,
  validatePersistedKeyBindings,
} from '../src/game/keyBindings';

function cloneDefaultsPlain(): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const action of GAME_ACTIONS) {
    copy[action] = [...DEFAULT_GAME_KEY_BINDINGS[action]];
  }
  return copy;
}

describe('default game key bindings and stateless lookup', () => {
  it('defines complete, conflict-free familiar FPS defaults', () => {
    const validated = validateKeyBindings(DEFAULT_GAME_KEY_BINDINGS);
    expect(validated.ok).toBe(true);

    expect(DEFAULT_GAME_KEY_BINDINGS).toEqual({
      moveForward: ['KeyW'],
      moveBackward: ['KeyS'],
      moveLeft: ['KeyA'],
      moveRight: ['KeyD'],
      lookLeft: ['ArrowLeft'],
      lookRight: ['ArrowRight'],
      lookUp: ['ArrowUp'],
      lookDown: ['ArrowDown'],
      jump: ['Space'],
      crouch: ['KeyC'],
      sprint: ['ShiftLeft', 'ShiftRight'],
      reset: ['KeyR'],
      heightDown: ['BracketLeft'],
      heightUp: ['BracketRight'],
      floorDown: ['PageDown'],
      floorUp: ['PageUp'],
    });
  });

  it('resolves every default action via stateless lookup helpers', () => {
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'KeyW')).toBe('moveForward');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'KeyS')).toBe('moveBackward');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'KeyA')).toBe('moveLeft');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'KeyD')).toBe('moveRight');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'ArrowLeft')).toBe('lookLeft');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'ArrowRight')).toBe('lookRight');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'ArrowUp')).toBe('lookUp');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'ArrowDown')).toBe('lookDown');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'Space')).toBe('jump');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'KeyC')).toBe('crouch');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'ShiftLeft')).toBe('sprint');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'ShiftRight')).toBe('sprint');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'KeyR')).toBe('reset');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'BracketLeft')).toBe('heightDown');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'BracketRight')).toBe('heightUp');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'PageDown')).toBe('floorDown');
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'PageUp')).toBe('floorUp');

    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'Escape')).toBeNull();
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'KeyZ')).toBeNull();
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, 'toString')).toBeNull();
    expect(getActionForCode(DEFAULT_GAME_KEY_BINDINGS, '__proto__')).toBeNull();

    expect(isBoundCode(DEFAULT_GAME_KEY_BINDINGS, 'Space')).toBe(true);
    expect(isBoundCode(DEFAULT_GAME_KEY_BINDINGS, 'Escape')).toBe(false);
    expect(isCodeBoundToAction(DEFAULT_GAME_KEY_BINDINGS, 'sprint', 'ShiftRight')).toBe(true);
    expect(isCodeBoundToAction(DEFAULT_GAME_KEY_BINDINGS, 'jump', 'ShiftRight')).toBe(false);
    expect(isActionActive(DEFAULT_GAME_KEY_BINDINGS, 'sprint', new Set(['ShiftLeft']))).toBe(true);
    expect(isActionActive(DEFAULT_GAME_KEY_BINDINGS, 'sprint', new Set(['ShiftRight']))).toBe(true);
    expect(isActionActive(DEFAULT_GAME_KEY_BINDINGS, 'sprint', new Set(['KeyW']))).toBe(false);
  });

  it('always reserves Escape for recovery and gates Shift assignability to sprint', () => {
    expect(RESERVED_RECOVERY_CODE).toBe('Escape');
    expect(isReservedRecoveryCode('Escape')).toBe(true);
    expect(isReservedRecoveryCode('Space')).toBe(false);

    expect(isAssignableCode('KeyF')).toBe(true);
    expect(isAssignableCode('Escape')).toBe(false);
    expect(isAssignableCode('Tab')).toBe(false);
    expect(isAssignableCode('ControlLeft')).toBe(false);
    expect(isAssignableCode('ShiftLeft')).toBe(false);
    expect(isAssignableCode('ShiftLeft', 'jump')).toBe(false);
    expect(isAssignableCode('ShiftLeft', 'sprint')).toBe(true);
    expect(isAssignableCode('ShiftRight', 'sprint')).toBe(true);
  });
});

describe('Shift sprint, duplicate, conflict, reserved, and unknown code validation', () => {
  it('supports both Shift keys or a single Shift key for sprint, and rejects duplicates', () => {
    const singleShift = rebindAction(DEFAULT_GAME_KEY_BINDINGS, 'sprint', ['ShiftLeft']);
    expect(singleShift.ok).toBe(true);
    if (singleShift.ok) {
      expect(singleShift.value.sprint).toEqual(['ShiftLeft']);
      expect(getActionForCode(singleShift.value, 'ShiftRight')).toBeNull();
    }

    const dupShift = rebindAction(DEFAULT_GAME_KEY_BINDINGS, 'sprint', ['ShiftLeft', 'ShiftLeft']);
    expect(dupShift.ok).toBe(false);
    if (!dupShift.ok) {
      expect(dupShift.error.code).toBe('duplicate-code-in-action');
      expect(dupShift.error.action).toBe('sprint');
      expect(dupShift.error.keyCode).toBe('ShiftLeft');
    }
  });

  it('rejects Shift assigned to non-sprint actions and cross-action conflicts', () => {
    const shiftOnCrouch = rebindAction(DEFAULT_GAME_KEY_BINDINGS, 'crouch', ['ShiftLeft']);
    expect(shiftOnCrouch.ok).toBe(false);
    if (!shiftOnCrouch.ok) {
      expect(shiftOnCrouch.error.code).toBe('shift-sprint-only');
      expect(shiftOnCrouch.error.action).toBe('crouch');
      expect(shiftOnCrouch.error.keyCode).toBe('ShiftLeft');
    }

    const crossConflict = rebindAction(DEFAULT_GAME_KEY_BINDINGS, 'jump', ['KeyW']);
    expect(crossConflict.ok).toBe(false);
    if (!crossConflict.ok) {
      expect(crossConflict.error.code).toBe('conflicting-code');
      expect(crossConflict.error.action).toBe('jump');
      expect(crossConflict.error.conflictAction).toBe('moveForward');
      expect(crossConflict.error.keyCode).toBe('KeyW');
    }
  });

  it.each([
    'Escape',
    'Tab',
    'ControlLeft',
    'ControlRight',
    'AltLeft',
    'AltRight',
    'MetaLeft',
    'MetaRight',
    'OSLeft',
    'Enter',
    'Backspace',
    'CapsLock',
    'ContextMenu',
    'F1',
    'F5',
    'F12',
    'BrowserBack',
  ])('rejects reserved browser/system/modifier code %s', (reservedCode) => {
    const result = rebindAction(DEFAULT_GAME_KEY_BINDINGS, 'jump', [reservedCode]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('reserved-code');
      expect(result.error.keyCode).toBe(reservedCode);
    }
  });

  it.each(['', ' ', 'w', 'Spacebar', 'KeyZZ', 'NotAKey', 'AudioVolumeUp'])(
    'rejects unknown non-whitelisted code %j',
    (badCode) => {
      const result = rebindAction(DEFAULT_GAME_KEY_BINDINGS, 'jump', [badCode]);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('unknown-code');
        expect(result.error.keyCode).toBe(badCode);
      }
    },
  );
});

describe('malformed JSON, version, schema, unknown actions, and all-or-nothing fallback', () => {
  it('falls back cleanly to defaults on malformed or oversized JSON', () => {
    const malformed = parseKeyBindingsJson('{not-json');
    expect(malformed.ok).toBe(false);
    expect(malformed.bindings).toBe(DEFAULT_GAME_KEY_BINDINGS);
    if (!malformed.ok) expect(malformed.error.code).toBe('invalid-json');

    const oversized = parseKeyBindingsJson(' '.repeat(MAX_PERSISTED_JSON_LENGTH + 1));
    expect(oversized.ok).toBe(false);
    expect(oversized.bindings).toBe(DEFAULT_GAME_KEY_BINDINGS);
    if (!oversized.ok) expect(oversized.error.code).toBe('payload-too-large');
  });

  it.each([0, 2, '1', null, true, undefined])('rejects unsupported version %j', (badVersion) => {
    const payload = { version: badVersion, bindings: cloneDefaultsPlain() };
    const result = validatePersistedKeyBindings(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unsupported-version');
  });

  it('rejects malformed envelopes, extra top-level fields, missing actions, unknown actions, and bad arrays', () => {
    expect(validatePersistedKeyBindings(null).ok).toBe(false);
    expect(validatePersistedKeyBindings([]).ok).toBe(false);

    const extraTop = validatePersistedKeyBindings({
      version: KEY_BINDINGS_VERSION,
      bindings: cloneDefaultsPlain(),
      extra: true,
    });
    expect(extraTop.ok).toBe(false);
    if (!extraTop.ok) expect(extraTop.error.code).toBe('unknown-field');

    const missingAction = cloneDefaultsPlain();
    delete missingAction.jump;
    const missingRes = validateKeyBindings(missingAction);
    expect(missingRes.ok).toBe(false);
    if (!missingRes.ok) {
      expect(missingRes.error.code).toBe('missing-action');
      expect(missingRes.error.action).toBe('jump');
    }

    const unknownAction = { ...cloneDefaultsPlain(), flyUp: ['KeyE'] };
    const unknownRes = validateKeyBindings(unknownAction);
    expect(unknownRes.ok).toBe(false);
    if (!unknownRes.ok) {
      expect(unknownRes.error.code).toBe('unknown-action');
      expect(unknownRes.error.field).toBe('flyUp');
    }

    const emptyCodes = { ...cloneDefaultsPlain(), jump: [] };
    const emptyRes = validateKeyBindings(emptyCodes);
    expect(emptyRes.ok).toBe(false);
    if (!emptyRes.ok) expect(emptyRes.error.code).toBe('empty-binding');

    const tooManyCodes = { ...cloneDefaultsPlain(), jump: ['Space', 'KeyJ', 'KeyK'] };
    const tooManyRes = validateKeyBindings(tooManyCodes);
    expect(tooManyRes.ok).toBe(false);
    if (!tooManyRes.ok) expect(tooManyRes.error.code).toBe('too-many-codes');

    const badType = { ...cloneDefaultsPlain(), jump: [42] };
    const badTypeRes = validateKeyBindings(badType);
    expect(badTypeRes.ok).toBe(false);
    if (!badTypeRes.ok) expect(badTypeRes.error.code).toBe('invalid-code-type');
  });

  it('enforces all-or-nothing fallback so a partial valid remap is never applied from corrupted JSON', () => {
    const partialCorrupt = cloneDefaultsPlain();
    partialCorrupt.jump = ['KeyJ']; // valid custom remap
    partialCorrupt.crouch = ['Escape']; // invalid reserved key

    const parsed = parseKeyBindingsJson(
      JSON.stringify({ version: KEY_BINDINGS_VERSION, bindings: partialCorrupt }),
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.bindings).toBe(DEFAULT_GAME_KEY_BINDINGS);
    // Custom remap on 'jump' must NOT leak through
    expect(parsed.bindings.jump).toEqual(['Space']);
    if (!parsed.ok) {
      expect(parsed.error.code).toBe('reserved-code');
      expect(parsed.error.action).toBe('crouch');
    }
  });
});

describe('prototype pollution protection, immutability, and serialization roundtrip', () => {
  it('rejects __proto__, constructor, and prototype fields in JSON and objects without polluting Object.prototype', () => {
    const defaultsJson = JSON.stringify(cloneDefaultsPlain());

    const topProto = parseKeyBindingsJson(
      `{"version":1,"__proto__":{"omniviewPolluted":true},"bindings":${defaultsJson}}`,
    );
    expect(topProto.ok).toBe(false);
    expect(topProto.bindings).toBe(DEFAULT_GAME_KEY_BINDINGS);
    if (!topProto.ok) {
      expect(topProto.error.code).toBe('unsafe-property');
      expect(topProto.error.field).toBe('__proto__');
    }
    expect('omniviewPolluted' in Object.prototype).toBe(false);

    for (const unsafeName of ['__proto__', 'constructor', 'prototype']) {
      const innerJson = `{"version":1,"bindings":${defaultsJson.slice(0, -1)},"${unsafeName}":["KeyZ"]}}`;
      const result = parseKeyBindingsJson(innerJson);
      expect(result.ok).toBe(false);
      expect(result.bindings).toBe(DEFAULT_GAME_KEY_BINDINGS);
      if (!result.ok) {
        expect(result.error.code).toBe('unsafe-property');
        expect(result.error.field).toBe(unsafeName);
      }
    }

    const inherited: unknown = Object.create(cloneDefaultsPlain());
    const inheritedRes = validateKeyBindings(inherited);
    expect(inheritedRes.ok).toBe(false);
    if (!inheritedRes.ok) expect(inheritedRes.error.code).toBe('invalid-bindings');
  });

  it('deep-freezes defaults and validated bindings against runtime mutation', () => {
    expect(Object.isFrozen(DEFAULT_GAME_KEY_BINDINGS)).toBe(true);
    for (const action of GAME_ACTIONS) {
      expect(Object.isFrozen(DEFAULT_GAME_KEY_BINDINGS[action])).toBe(true);
    }

    expect(Reflect.set(DEFAULT_GAME_KEY_BINDINGS, 'jump', ['KeyJ'])).toBe(false);
    expect(() =>
      Object.defineProperty(DEFAULT_GAME_KEY_BINDINGS, 'jump', { value: ['KeyJ'] }),
    ).toThrow(TypeError);
    expect(() =>
      Array.prototype.push.call(DEFAULT_GAME_KEY_BINDINGS.sprint, 'KeyQ'),
    ).toThrow(TypeError);
    expect(DEFAULT_GAME_KEY_BINDINGS.jump).toEqual(['Space']);
    expect(DEFAULT_GAME_KEY_BINDINGS.sprint).toEqual(['ShiftLeft', 'ShiftRight']);

    const remapped = rebindAction(DEFAULT_GAME_KEY_BINDINGS, 'jump', ['KeyJ']);
    expect(remapped.ok).toBe(true);
    if (remapped.ok) {
      expect(Object.isFrozen(remapped.value)).toBe(true);
      expect(Object.isFrozen(remapped.value.jump)).toBe(true);
      expect(DEFAULT_GAME_KEY_BINDINGS.jump).toEqual(['Space']);
    }
  });

  it('roundtrips defaults and custom valid bindings cleanly through versioned JSON', () => {
    const defaultSerialized = serializeKeyBindings(DEFAULT_GAME_KEY_BINDINGS);
    const defaultParsed = parseKeyBindingsJson(defaultSerialized);
    expect(defaultParsed.ok).toBe(true);
    if (defaultParsed.ok) {
      expect(defaultParsed.version).toBe(KEY_BINDINGS_VERSION);
      expect(defaultParsed.bindings).toEqual(DEFAULT_GAME_KEY_BINDINGS);
    }

    const step1 = rebindAction(DEFAULT_GAME_KEY_BINDINGS, 'jump', ['KeyF']);
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;

    const step2 = rebindAction(step1.value, 'crouch', ['KeyV', 'KeyX']);
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;

    const step3 = rebindAction(step2.value, 'sprint', ['ShiftRight']);
    expect(step3.ok).toBe(true);
    if (!step3.ok) return;

    const serialized = serializeKeyBindings(step3.value);
    const reparsed = parseKeyBindingsJson(serialized);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) {
      expect(reparsed.version).toBe(KEY_BINDINGS_VERSION);
      expect(reparsed.bindings).toEqual(step3.value);
      expect(getActionForCode(reparsed.bindings, 'KeyF')).toBe('jump');
      expect(getActionForCode(reparsed.bindings, 'KeyX')).toBe('crouch');
      expect(getActionForCode(reparsed.bindings, 'ShiftRight')).toBe('sprint');
      expect(getActionForCode(reparsed.bindings, 'ShiftLeft')).toBeNull();
    }
  });
});
