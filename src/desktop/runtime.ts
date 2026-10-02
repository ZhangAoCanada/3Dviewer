/**
 * True when the page is running inside the Tauri shell.
 * Tauri injects `__TAURI_INTERNALS__` before page scripts run.
 * The web build and the service worker stay as they are when this is false.
 */
export function isDesktopApp(scope: object = globalThis): boolean {
  return '__TAURI_INTERNALS__' in scope || '__TAURI__' in scope;
}
