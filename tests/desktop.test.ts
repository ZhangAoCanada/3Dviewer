import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { appBase } from '../src/desktop/basePath';
import { isDesktopApp } from '../src/desktop/runtime';
import { detectDesktopOs, unsignedInstallNote } from '../src/ui/downloadDesktop';

describe('desktop shell', () => {
  it('keeps the Pages base and uses a relative base for Tauri', () => {
    expect(appBase(undefined)).toBe('/3Dviewer/');
    expect(appBase('')).toBe('/3Dviewer/');
    expect(appBase('linux')).toBe('./');
    expect(appBase('windows')).toBe('./');
    expect(appBase('darwin')).toBe('./');
  });

  it('detects the Tauri shell without treating the browser as desktop', () => {
    expect(isDesktopApp({})).toBe(false);
    expect(isDesktopApp({ __TAURI_INTERNALS__: {} })).toBe(true);
    expect(isDesktopApp({ __TAURI__: {} })).toBe(true);
  });

  it('hands local files to the WebView instead of reading them into a second buffer', () => {
    const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as {
      build: { frontendDist: string; beforeBuildCommand: string };
      app: { windows: { dragDropEnabled: boolean; label: string }[] };
      bundle: { targets: string[]; macOS: { signingIdentity: string } };
    };
    expect(conf.app.windows[0]?.dragDropEnabled).toBe(false);
    expect(conf.app.windows[0]?.label).toBe('main');
    expect(conf.build.frontendDist).toBe('../dist');
    expect(conf.build.beforeBuildCommand).toBe('npm run build');
    expect(conf.bundle.macOS.signingIdentity).toBe('-');
    expect(conf.bundle.targets).toEqual(['dmg', 'msi', 'nsis', 'appimage', 'deb']);
  });
});

describe('detectDesktopOs', () => {
  it('highlights the host OS and skips phones', () => {
    expect(detectDesktopOs({ userAgent: 'Mozilla/5.0 Windows NT 10.0', platform: 'Win32' })).toBe('windows');
    expect(detectDesktopOs({ userAgent: 'Mozilla/5.0 Macintosh', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(
      'macos',
    );
    expect(detectDesktopOs({ userAgent: 'Mozilla/5.0 X11; Linux x86_64', platform: 'Linux x86_64' })).toBe('linux');
    expect(detectDesktopOs({ userAgent: 'Mozilla/5.0 iPhone', platform: 'iPhone' })).toBe('other');
    expect(detectDesktopOs({ userAgent: 'Mozilla/5.0 Android', platform: 'Linux armv8l' })).toBe('other');
    expect(
      detectDesktopOs({ userAgent: 'Mozilla/5.0 Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }),
    ).toBe('other');
  });

  it('names the unsigned-install step for the matching OS', () => {
    expect(unsignedInstallNote('windows')).toMatch(/SmartScreen/);
    expect(unsignedInstallNote('macos')).toMatch(/Right-click/);
    expect(unsignedInstallNote('linux')).toMatch(/unsigned/);
    expect(unsignedInstallNote('other')).toMatch(/SmartScreen/);
  });
});
