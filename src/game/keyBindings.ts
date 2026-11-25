/**
 * Pure, bounded keyboard-binding schema, validator, stateless lookup helpers,
 * and versioned JSON parser/serializer for Omniview Game mode.
 *
 * No DOM, browser storage, or physics dependencies.
 */

export const KEY_BINDINGS_VERSION = 1 as const;
export const RESERVED_RECOVERY_CODE = 'Escape' as const;
export const MAX_CODES_PER_ACTION = 2 as const;
export const MAX_PERSISTED_JSON_LENGTH = 4096 as const;

export const GAME_ACTIONS = Object.freeze([
  'moveForward',
  'moveBackward',
  'moveLeft',
  'moveRight',
  'lookLeft',
  'lookRight',
  'lookUp',
  'lookDown',
  'jump',
  'crouch',
  'sprint',
  'reset',
  'heightDown',
  'heightUp',
  'floorDown',
  'floorUp',
] as const);

export type GameAction = (typeof GAME_ACTIONS)[number];

/**
 * Finite explicit whitelist of standalone KeyboardEvent.code values safe for
 * general gameplay remapping. Excludes Escape, Tab, Enter, Backspace, Delete,
 * Home/End/Insert, function keys, OS/browser keys, and modifier keys.
 */
export const SAFE_KEY_CODES = Object.freeze([
  'KeyA', 'KeyB', 'KeyC', 'KeyD', 'KeyE', 'KeyF', 'KeyG', 'KeyH', 'KeyI', 'KeyJ',
  'KeyK', 'KeyL', 'KeyM', 'KeyN', 'KeyO', 'KeyP', 'KeyQ', 'KeyR', 'KeyS', 'KeyT',
  'KeyU', 'KeyV', 'KeyW', 'KeyX', 'KeyY', 'KeyZ',
  'Digit0', 'Digit1', 'Digit2', 'Digit3', 'Digit4',
  'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'Space', 'PageUp', 'PageDown',
  'BracketLeft', 'BracketRight', 'Minus', 'Equal',
  'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'Backslash',
  'Numpad0', 'Numpad1', 'Numpad2', 'Numpad3', 'Numpad4',
  'Numpad5', 'Numpad6', 'Numpad7', 'Numpad8', 'Numpad9',
  'NumpadAdd', 'NumpadSubtract',
] as const);

export type SafeKeyCode = (typeof SAFE_KEY_CODES)[number];

/**
 * Modifier keys explicitly permitted standalone ONLY for the 'sprint' action.
 */
export const SHIFT_KEY_CODES = Object.freeze(['ShiftLeft', 'ShiftRight'] as const);

export type ShiftKeyCode = (typeof SHIFT_KEY_CODES)[number];
export type AssignableKeyCode = SafeKeyCode | ShiftKeyCode;
export type GameKeyBindings = Readonly<Record<GameAction, readonly AssignableKeyCode[]>>;

/**
 * Known reserved recovery, navigation, modifier, and browser/system codes that
 * must never be assigned to gameplay actions.
 */
export const RESERVED_KEY_CODES: readonly string[] = Object.freeze([
  RESERVED_RECOVERY_CODE,
  'Tab',
  'Enter',
  'NumpadEnter',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'ContextMenu',
  'PrintScreen',
  'Pause',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
  'Fn',
  'FnLock',
  'Power',
  'Sleep',
  'WakeUp',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12',
  'F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19', 'F20', 'F21', 'F22', 'F23', 'F24',
  'BrowserBack',
  'BrowserForward',
  'BrowserRefresh',
  'BrowserStop',
  'BrowserSearch',
  'BrowserFavorites',
  'BrowserHome',
]);

export type KeyBindingsErrorCode =
  | 'invalid-json'
  | 'payload-too-large'
  | 'invalid-payload'
  | 'unsupported-version'
  | 'unsafe-property'
  | 'unknown-field'
  | 'invalid-bindings'
  | 'missing-action'
  | 'unknown-action'
  | 'invalid-action-binding'
  | 'empty-binding'
  | 'too-many-codes'
  | 'invalid-code-type'
  | 'reserved-code'
  | 'shift-sprint-only'
  | 'unknown-code'
  | 'duplicate-code-in-action'
  | 'conflicting-code';

export interface KeyBindingsError {
  readonly code: KeyBindingsErrorCode;
  readonly message: string;
  readonly action?: GameAction;
  readonly keyCode?: string;
  readonly conflictAction?: GameAction;
  readonly field?: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: KeyBindingsError };

export type ParseKeyBindingsResult =
  | {
      readonly ok: true;
      readonly version: typeof KEY_BINDINGS_VERSION;
      readonly bindings: GameKeyBindings;
    }
  | {
      readonly ok: false;
      readonly bindings: GameKeyBindings;
      readonly error: KeyBindingsError;
    };

const UNSAFE_PROPERTY_NAMES: ReadonlySet<string> = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

const ACTION_MAP = new Map<string, GameAction>();
for (const action of GAME_ACTIONS) ACTION_MAP.set(action, action);

const SAFE_CODE_MAP = new Map<string, SafeKeyCode>();
for (const code of SAFE_KEY_CODES) SAFE_CODE_MAP.set(code, code);

const SHIFT_CODE_MAP = new Map<string, ShiftKeyCode>();
for (const code of SHIFT_KEY_CODES) SHIFT_CODE_MAP.set(code, code);

const RESERVED_CODE_SET: ReadonlySet<string> = new Set(RESERVED_KEY_CODES);

function freezeBindings(bindings: Record<GameAction, readonly AssignableKeyCode[]>): GameKeyBindings {
  return Object.freeze({
    moveForward: Object.freeze([...bindings.moveForward]),
    moveBackward: Object.freeze([...bindings.moveBackward]),
    moveLeft: Object.freeze([...bindings.moveLeft]),
    moveRight: Object.freeze([...bindings.moveRight]),
    lookLeft: Object.freeze([...bindings.lookLeft]),
    lookRight: Object.freeze([...bindings.lookRight]),
    lookUp: Object.freeze([...bindings.lookUp]),
    lookDown: Object.freeze([...bindings.lookDown]),
    jump: Object.freeze([...bindings.jump]),
    crouch: Object.freeze([...bindings.crouch]),
    sprint: Object.freeze([...bindings.sprint]),
    reset: Object.freeze([...bindings.reset]),
    heightDown: Object.freeze([...bindings.heightDown]),
    heightUp: Object.freeze([...bindings.heightUp]),
    floorDown: Object.freeze([...bindings.floorDown]),
    floorUp: Object.freeze([...bindings.floorUp]),
  });
}

export const DEFAULT_GAME_KEY_BINDINGS: GameKeyBindings = freezeBindings({
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function findUnsafeOwnProperty(obj: object): string | null {
  for (const name of Object.getOwnPropertyNames(obj)) {
    if (UNSAFE_PROPERTY_NAMES.has(name)) return name;
  }
  return null;
}

function fail<T>(error: KeyBindingsError): ValidationResult<T> {
  return { ok: false, error };
}

function resolveCodeForAction(
  action: GameAction,
  rawCode: unknown,
): ValidationResult<AssignableKeyCode> {
  if (typeof rawCode !== 'string') {
    return fail({
      code: 'invalid-code-type',
      action,
      message: `Binding for "${action}" must contain KeyboardEvent.code strings.`,
    });
  }
  if (RESERVED_CODE_SET.has(rawCode)) {
    return fail({
      code: 'reserved-code',
      action,
      keyCode: rawCode,
      message: `"${rawCode}" is reserved and cannot be assigned to "${action}".`,
    });
  }
  const shiftCode = SHIFT_CODE_MAP.get(rawCode);
  if (shiftCode !== undefined) {
    if (action !== 'sprint') {
      return fail({
        code: 'shift-sprint-only',
        action,
        keyCode: rawCode,
        message: `"${rawCode}" is only allowed for the "sprint" action.`,
      });
    }
    return { ok: true, value: shiftCode };
  }
  const safeCode = SAFE_CODE_MAP.get(rawCode);
  if (safeCode !== undefined) {
    return { ok: true, value: safeCode };
  }
  return fail({
    code: 'unknown-code',
    action,
    keyCode: rawCode,
    message: `"${rawCode}" is not in the supported KeyboardEvent.code whitelist.`,
  });
}

/**
 * Validates an untrusted action -> code[] mapping. All actions must be present,
 * non-empty, conflict-free, within whitelist/bounds, and free of unknown or
 * prototype-polluting properties.
 */
export function validateKeyBindings(input: unknown): ValidationResult<GameKeyBindings> {
  if (!isPlainObject(input)) {
    return fail({
      code: 'invalid-bindings',
      message: 'Key bindings must be a plain object.',
    });
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    return fail({
      code: 'unknown-action',
      message: 'Key bindings must not contain symbol properties.',
    });
  }
  const unsafe = findUnsafeOwnProperty(input);
  if (unsafe !== null) {
    return fail({
      code: 'unsafe-property',
      field: unsafe,
      message: `Rejected unsafe property "${unsafe}" in key bindings.`,
    });
  }

  for (const prop of Object.getOwnPropertyNames(input)) {
    if (!ACTION_MAP.has(prop)) {
      return fail({
        code: 'unknown-action',
        field: prop,
        message: `Unknown action "${prop}" in key bindings.`,
      });
    }
  }

  const assignedOwners = new Map<AssignableKeyCode, GameAction>();
  const validated = new Map<GameAction, readonly AssignableKeyCode[]>();

  for (const action of GAME_ACTIONS) {
    if (!Object.prototype.hasOwnProperty.call(input, action)) {
      return fail({
        code: 'missing-action',
        action,
        message: `Missing required action "${action}".`,
      });
    }
    const rawList: unknown = input[action];
    if (!Array.isArray(rawList)) {
      return fail({
        code: 'invalid-action-binding',
        action,
        message: `Binding for "${action}" must be an array of key codes.`,
      });
    }
    if (rawList.length === 0) {
      return fail({
        code: 'empty-binding',
        action,
        message: `Action "${action}" must have at least one bound key code.`,
      });
    }
    if (rawList.length > MAX_CODES_PER_ACTION) {
      return fail({
        code: 'too-many-codes',
        action,
        message: `Action "${action}" exceeds the maximum of ${MAX_CODES_PER_ACTION} key codes.`,
      });
    }

    const actionSeen = new Set<AssignableKeyCode>();
    const actionCodes: AssignableKeyCode[] = [];
    for (let i = 0; i < rawList.length; i += 1) {
      if (!Object.prototype.hasOwnProperty.call(rawList, i)) {
        return fail({
          code: 'invalid-code-type',
          action,
          message: `Binding array for "${action}" must not be sparse.`,
        });
      }
      const resolved = resolveCodeForAction(action, rawList[i]);
      if (!resolved.ok) return resolved;
      const code = resolved.value;

      if (actionSeen.has(code)) {
        return fail({
          code: 'duplicate-code-in-action',
          action,
          keyCode: code,
          message: `Duplicate key code "${code}" within action "${action}".`,
        });
      }
      const existingOwner = assignedOwners.get(code);
      if (existingOwner !== undefined) {
        return fail({
          code: 'conflicting-code',
          action,
          conflictAction: existingOwner,
          keyCode: code,
          message: `Key code "${code}" conflicts between "${existingOwner}" and "${action}".`,
        });
      }
      actionSeen.add(code);
      assignedOwners.set(code, action);
      actionCodes.push(code);
    }

    validated.set(action, Object.freeze(actionCodes));
  }

  const getValidated = (action: GameAction): readonly AssignableKeyCode[] => {
    const codes = validated.get(action);
    return codes ?? DEFAULT_GAME_KEY_BINDINGS[action];
  };

  return {
    ok: true,
    value: freezeBindings({
      moveForward: getValidated('moveForward'),
      moveBackward: getValidated('moveBackward'),
      moveLeft: getValidated('moveLeft'),
      moveRight: getValidated('moveRight'),
      lookLeft: getValidated('lookLeft'),
      lookRight: getValidated('lookRight'),
      lookUp: getValidated('lookUp'),
      lookDown: getValidated('lookDown'),
      jump: getValidated('jump'),
      crouch: getValidated('crouch'),
      sprint: getValidated('sprint'),
      reset: getValidated('reset'),
      heightDown: getValidated('heightDown'),
      heightUp: getValidated('heightUp'),
      floorDown: getValidated('floorDown'),
      floorUp: getValidated('floorUp'),
    }),
  };
}

/**
 * Validates an untrusted versioned persistence envelope `{ version: 1, bindings }`.
 */
export function validatePersistedKeyBindings(input: unknown): ValidationResult<GameKeyBindings> {
  if (!isPlainObject(input)) {
    return fail({
      code: 'invalid-payload',
      message: 'Persisted key bindings payload must be a plain object.',
    });
  }
  if (Object.getOwnPropertySymbols(input).length > 0) {
    return fail({
      code: 'unknown-field',
      message: 'Persisted key bindings payload must not contain symbol properties.',
    });
  }
  const unsafe = findUnsafeOwnProperty(input);
  if (unsafe !== null) {
    return fail({
      code: 'unsafe-property',
      field: unsafe,
      message: `Rejected unsafe property "${unsafe}" in persisted payload.`,
    });
  }
  for (const prop of Object.getOwnPropertyNames(input)) {
    if (prop !== 'version' && prop !== 'bindings') {
      return fail({
        code: 'unknown-field',
        field: prop,
        message: `Unexpected field "${prop}" in persisted key bindings payload.`,
      });
    }
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'version') || input.version !== KEY_BINDINGS_VERSION) {
    return fail({
      code: 'unsupported-version',
      field: 'version',
      message: `Expected key bindings version ${KEY_BINDINGS_VERSION}.`,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(input, 'bindings')) {
    return fail({
      code: 'invalid-bindings',
      field: 'bindings',
      message: 'Missing "bindings" field in persisted key bindings payload.',
    });
  }
  return validateKeyBindings(input.bindings);
}

/**
 * Pure versioned JSON parser with strict all-or-nothing fallback to
 * DEFAULT_GAME_KEY_BINDINGS on any syntax, version, schema, or conflict error.
 */
export function parseKeyBindingsJson(raw: string): ParseKeyBindingsResult {
  if (typeof raw !== 'string') {
    return {
      ok: false,
      bindings: DEFAULT_GAME_KEY_BINDINGS,
      error: {
        code: 'invalid-json',
        message: 'Persisted key bindings input must be a JSON string.',
      },
    };
  }
  if (raw.length > MAX_PERSISTED_JSON_LENGTH) {
    return {
      ok: false,
      bindings: DEFAULT_GAME_KEY_BINDINGS,
      error: {
        code: 'payload-too-large',
        message: `Persisted key bindings JSON exceeds ${MAX_PERSISTED_JSON_LENGTH} characters.`,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      bindings: DEFAULT_GAME_KEY_BINDINGS,
      error: {
        code: 'invalid-json',
        message: 'Persisted key bindings contain malformed JSON.',
      },
    };
  }

  const validated = validatePersistedKeyBindings(parsed);
  if (!validated.ok) {
    return {
      ok: false,
      bindings: DEFAULT_GAME_KEY_BINDINGS,
      error: validated.error,
    };
  }

  return {
    ok: true,
    version: KEY_BINDINGS_VERSION,
    bindings: validated.value,
  };
}

/**
 * Pure canonical versioned JSON serializer. Defensively validates bindings so
 * corrupted runtime structures are never emitted.
 */
export function serializeKeyBindings(bindings: GameKeyBindings): string {
  const validated = validateKeyBindings(bindings);
  if (!validated.ok) {
    throw new TypeError(`Cannot serialize invalid key bindings: ${validated.error.message}`);
  }
  return JSON.stringify({
    version: KEY_BINDINGS_VERSION,
    bindings: validated.value,
  });
}

/**
 * Pure functional single-action rebind helper. Returns a new frozen
 * GameKeyBindings on success, or an explicit error leaving `current` untouched.
 */
export function rebindAction(
  current: GameKeyBindings,
  action: GameAction,
  codes: readonly string[],
): ValidationResult<GameKeyBindings> {
  const base = validateKeyBindings(current);
  if (!base.ok) return base;
  if (!ACTION_MAP.has(action)) {
    return fail({
      code: 'unknown-action',
      field: String(action),
      message: `Unknown action "${String(action)}".`,
    });
  }
  if (!Array.isArray(codes)) {
    return fail({
      code: 'invalid-action-binding',
      action,
      message: `Binding for "${action}" must be an array of key codes.`,
    });
  }

  const candidate: Record<string, readonly string[]> = {
    moveForward: base.value.moveForward,
    moveBackward: base.value.moveBackward,
    moveLeft: base.value.moveLeft,
    moveRight: base.value.moveRight,
    lookLeft: base.value.lookLeft,
    lookRight: base.value.lookRight,
    lookUp: base.value.lookUp,
    lookDown: base.value.lookDown,
    jump: base.value.jump,
    crouch: base.value.crouch,
    sprint: base.value.sprint,
    reset: base.value.reset,
    heightDown: base.value.heightDown,
    heightUp: base.value.heightUp,
    floorDown: base.value.floorDown,
    floorUp: base.value.floorUp,
  };
  candidate[action] = [...codes];
  return validateKeyBindings(candidate);
}

/** True only for the unremappable recovery key (`Escape`). */
export function isReservedRecoveryCode(code: string): boolean {
  return code === RESERVED_RECOVERY_CODE;
}

/**
 * True if `code` is permitted in the safe whitelist. ShiftLeft/ShiftRight are
 * permitted only when `action === 'sprint'`.
 */
export function isAssignableCode(code: string, action?: GameAction): boolean {
  if (SAFE_CODE_MAP.has(code)) return true;
  return action === 'sprint' && SHIFT_CODE_MAP.has(code);
}


/** Stateless reverse lookup: returns the action bound to `code`, or null. */
export function getActionForCode(bindings: GameKeyBindings, code: string): GameAction | null {
  if (typeof code !== 'string' || code.length === 0) return null;
  for (const action of GAME_ACTIONS) {
    for (const bound of bindings[action]) {
      if (bound === code) return action;
    }
  }
  return null;
}

/** Stateless membership check for a specific action and `KeyboardEvent.code`. */
export function isCodeBoundToAction(
  bindings: GameKeyBindings,
  action: GameAction,
  code: string,
): boolean {
  if (!ACTION_MAP.has(action) || typeof code !== 'string') return false;
  const codes = bindings[action];
  for (const bound of codes) {
    if (bound === code) return true;
  }
  return false;
}

/** Stateless check whether any bound code for `action` is currently held. */
export function isActionActive(
  bindings: GameKeyBindings,
  action: GameAction,
  pressedCodes: ReadonlySet<string>,
): boolean {
  if (!ACTION_MAP.has(action)) return false;
  for (const bound of bindings[action]) {
    if (pressedCodes.has(bound)) return true;
  }
  return false;
}

/** Stateless check whether `code` is bound to any gameplay action. */
export function isBoundCode(bindings: GameKeyBindings, code: string): boolean {
  return getActionForCode(bindings, code) !== null;
}
