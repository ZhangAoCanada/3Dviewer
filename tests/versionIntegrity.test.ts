import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

function jsonVersion(path: string, rootPackage = false): string {
  const metadata: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof metadata !== 'object' || metadata === null) throw new Error(`Invalid ${path}`);
  if (rootPackage) {
    if (!('packages' in metadata) || typeof metadata.packages !== 'object' || metadata.packages === null || !('' in metadata.packages)) throw new Error(`Missing root package in ${path}`);
    const root: unknown = metadata.packages[''];
    if (typeof root === 'object' && root !== null && 'version' in root && typeof root.version === 'string') return root.version;
  } else if ('version' in metadata && typeof metadata.version === 'string') return metadata.version;
  throw new Error(`Missing version in ${path}`);
}

it('keeps web, npm locks, Tauri and the application Cargo lock version aligned', () => {
  const version = jsonVersion('package.json');
  expect(version).toMatch(/^\d+\.\d+\.\d+(?:[-+].+)?$/);
  expect(jsonVersion('package-lock.json')).toBe(version);
  expect(jsonVersion('package-lock.json', true)).toBe(version);
  expect(jsonVersion('src-tauri/tauri.conf.json')).toBe(version);
  const rustPackage = readFileSync('src-tauri/Cargo.toml', 'utf8').split('[package]')[1]?.split(/^\[/m)[0];
  expect(rustPackage?.match(/^version = "([^"]+)"$/m)?.[1]).toBe(version);
  const crateName = rustPackage?.match(/^name = "([^"]+)"$/m)?.[1];
  expect(crateName).toBeTruthy();
  const lockPackage = readFileSync('src-tauri/Cargo.lock', 'utf8').split('[[package]]').find(block => block.match(/^name = "([^"]+)"$/m)?.[1] === crateName);
  expect(lockPackage?.match(/^version = "([^"]+)"$/m)?.[1]).toBe(version);
});
