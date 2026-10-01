import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const swPath = join(root, 'dist', 'sw.js');
const assetsDir = join(root, 'dist', 'assets');

let manifest;
try {
  manifest = readFileSync(swPath, 'utf8');
} catch {
  console.error(`check-precache: missing ${swPath}. Run the production build first.`);
  process.exit(1);
}

const names = readdirSync(assetsDir).filter(
  (name) => /^index-.*\.js$/.test(name) || /\.worker-.*\.js$/.test(name),
);
if (names.length === 0) {
  console.error('check-precache: no index-*.js or *.worker-*.js bundles in dist/assets');
  process.exit(1);
}

const missing = names.filter((name) => !manifest.includes(name));
if (missing.length > 0) {
  console.error(`check-precache: missing from the precache manifest: ${missing.join(', ')}`);
  process.exit(1);
}

console.log(`check-precache: ${names.join(', ')}`);
