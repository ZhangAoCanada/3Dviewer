/**
 * GitHub Pages serves the site at `/3Dviewer/`.
 * The Tauri webview loads the same build from its own origin, so the desktop
 * build uses a relative base. `TAURI_ENV_PLATFORM` is set only by the Tauri CLI.
 */
export function appBase(platform: string | undefined = process.env.TAURI_ENV_PLATFORM): string {
  return platform ? './' : '/3Dviewer/';
}
