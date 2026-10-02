export const RELEASES_URL = 'https://github.com/ZhangAoCanada/3Dviewer/releases/latest';

export type DesktopOs = 'windows' | 'macos' | 'linux' | 'other';

export interface OsProbe {
  userAgent: string;
  platform: string;
  maxTouchPoints?: number;
}

export interface DesktopPlatform {
  os: Exclude<DesktopOs, 'other'>;
  label: string;
  files: string;
}

export const DESKTOP_PLATFORMS: readonly DesktopPlatform[] = [
  { os: 'windows', label: 'Windows', files: '.msi and .exe' },
  { os: 'macos', label: 'macOS', files: 'universal .dmg' },
  { os: 'linux', label: 'Linux', files: '.AppImage and .deb' },
];

function defaultProbe(): OsProbe {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  };
}

/** Desktop OS for the installer list. Phones and iPads are `other` (no matching installer). */
export function detectDesktopOs(probe: OsProbe = defaultProbe()): DesktopOs {
  const ua = probe.userAgent;
  const platform = probe.platform;
  const touch = probe.maxTouchPoints ?? 0;
  if (/Android|iPhone|iPad|iPod/i.test(ua)) return 'other';
  // iPadOS 13+ uses a Macintosh user agent. A touch Mac is rare; missing the highlight is safer.
  if (/Mac/i.test(platform) && touch > 1) return 'other';
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return 'windows';
  if (/Mac/i.test(platform) || /Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/Linux/i.test(platform) || /Linux/i.test(ua)) return 'linux';
  return 'other';
}

export function unsignedInstallNote(os: DesktopOs): string {
  if (os === 'windows') {
    return 'Windows SmartScreen will warn that this unsigned app is unrecognized. Choose More info, then Run anyway.';
  }
  if (os === 'macos') {
    return 'These builds are not notarized. Right-click the app, choose Open, then Open again.';
  }
  if (os === 'linux') {
    return 'The .AppImage and .deb are unsigned.';
  }
  return 'Windows SmartScreen warns on the .msi and .exe. On macOS, right-click the app and choose Open. Linux builds are an .AppImage and a .deb.';
}
