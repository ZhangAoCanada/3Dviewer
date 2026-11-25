export const FPS_PREFERENCES_KEY = 'omniview-fps-preferences-v1';
export interface GamePreferences { speed: number; sensitivity: number; reducedMotion: boolean }
export function defaultPreferences(): GamePreferences {
  return { speed: 1, sensitivity: 1, reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches };
}
export function parsePreferences(value: unknown): GamePreferences | null {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
    !('speed' in value) || typeof value.speed !== 'number' || !Number.isFinite(value.speed) || value.speed < .25 || value.speed > 4 ||
    !('sensitivity' in value) || typeof value.sensitivity !== 'number' || !Number.isFinite(value.sensitivity) || value.sensitivity < .4 || value.sensitivity > 2 ||
    !('reducedMotion' in value) || typeof value.reducedMotion !== 'boolean') return null;
  return { speed: value.speed, sensitivity: value.sensitivity, reducedMotion: value.reducedMotion };
}
export function readPreferences(): GamePreferences {
  try { const text = localStorage.getItem(FPS_PREFERENCES_KEY);return text ? parsePreferences(JSON.parse(text)) ?? defaultPreferences() : defaultPreferences(); }
  catch { return defaultPreferences(); }
}
export function savePreferences(value: GamePreferences): void {
  try { localStorage.setItem(FPS_PREFERENCES_KEY, JSON.stringify({ version: 1, ...value })); } catch { /* Session controls remain usable without storage. */ }
}
