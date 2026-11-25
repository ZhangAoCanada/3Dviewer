import { DEFAULT_GAME_KEY_BINDINGS, parseKeyBindingsJson, serializeKeyBindings, type GameKeyBindings, type GameAction } from './keyBindings';
export const GAME_BINDINGS_KEY = 'omniview-fps-keys-v1';
export const ACTION_LABELS = {
 moveForward:'Move forward',moveBackward:'Move backward',moveLeft:'Strafe left',moveRight:'Strafe right',lookLeft:'Look left',lookRight:'Look right',lookUp:'Look up',lookDown:'Look down',jump:'Jump / virtual hop',crouch:'Toggle crouch',sprint:'Sprint',reset:'Reset to spawn',heightDown:'Body height down',heightUp:'Body height up',floorDown:'Virtual floor down',floorUp:'Virtual floor up',
} satisfies Record<GameAction,string>;
export function keyLabel(code:string):string {
 const names:Record<string,string>={Space:'Space',ShiftLeft:'Left Shift',ShiftRight:'Right Shift',ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',BracketLeft:'[',BracketRight:']',PageUp:'Page Up',PageDown:'Page Down',Slash:'/',Backslash:'\\',Minus:'−',Equal:'=',Semicolon:';',Quote:'"',Comma:',',Period:'.'};
 return names[code]??code.replace(/^Key|^Digit/,'').replace('Numpad','Num ');
}
export function bindingLabel(bindings:GameKeyBindings,action:GameAction):string {return bindings[action].map(keyLabel).join(' / ');}
export function readBindingSettings():{bindings:GameKeyBindings;error:string} {
 try {const raw=localStorage.getItem(GAME_BINDINGS_KEY);if(raw===null)return {bindings:DEFAULT_GAME_KEY_BINDINGS,error:''};const result=parseKeyBindingsJson(raw);return {bindings:result.bindings,error:result.ok?'':`Saved keys invalid; using defaults. ${result.error.message}`};}
 catch {return {bindings:DEFAULT_GAME_KEY_BINDINGS,error:'Key storage unavailable; defaults remain usable.'};}
}
export function saveBindingSettings(bindings:GameKeyBindings):boolean {try {localStorage.setItem(GAME_BINDINGS_KEY,serializeKeyBindings(bindings));return true;}catch{return false;}}
