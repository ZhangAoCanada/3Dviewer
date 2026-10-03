import { describe, expect, it } from 'vitest';
import { formatReport, type Diagnostics } from '../src/core/diagnostics';

function sample(overrides: Partial<Diagnostics> = {}): Diagnostics {
  return {
    build: 'abc1234',
    desktop: false,
    pwa: false,
    userAgent: 'TestBrowser',
    platform: 'Linux',
    language: 'en',
    webgl2: false,
    webgl1: true,
    maxTextureSize: 4096,
    software: true,
    profile: 'desktop',
    cpuBytes: 1024,
    load: {
      name: 'room.ply',
      url: 'https://scans.example.com/private/room.ply?token=secret',
      preset: 'automatic',
    },
    ...overrides,
  };
}

describe('formatReport', () => {
  it('starts with the build and keeps only the URL host', () => {
    const report = formatReport(sample());
    expect(report.startsWith('Omniview abc1234')).toBe(true);
    expect(report).toContain('Host: scans.example.com');
    expect(report).not.toContain('/private');
    expect(report).not.toContain('room.ply?');
    expect(report).not.toContain('token');
    expect(report).not.toContain('secret');
  });

  it('prints WebGL2 and the software renderer as yes or no', () => {
    const report = formatReport(sample({ webgl2: false, software: true }));
    expect(report).toContain('WebGL2: no');
    expect(report).toContain('Software renderer: yes');
    const hardware = formatReport(sample({ webgl2: true, software: false, load: undefined }));
    expect(hardware).toContain('WebGL2: yes');
    expect(hardware).toContain('Software renderer: no');
    expect(hardware).not.toContain('Host:');
  });
});
