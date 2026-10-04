import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import sharp from 'sharp';

/**
 * Run by hand (`npm run thumbs`). Not part of CI.
 * Builds the viewer, opens each local sample in SwiftShader, and writes a
 * 192×144 WebP thumbnail.
 */
const port = 4183;
const origin = `http://127.0.0.1:${port}/3Dviewer/`;
const ids = ['torus-ply', 'torus-splat', 'cloud', 'crate', 'sphere'];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`))));
    child.on('error', reject);
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(origin);
      if (res.ok) return;
    } catch {
      /* preview is still starting */
    }
    await delay(250);
  }
  throw new Error(`preview did not answer on ${origin}`);
}

await run('npm', ['run', 'build']);
const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  stdio: 'inherit',
});

try {
  await waitForServer();
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width: 384, height: 288 }, deviceScaleFactor: 1 });
  await mkdir('public/samples/thumbs', { recursive: true });
  for (const id of ids) {
    await page.goto(`${origin}?sample=${id}`);
    await page.waitForFunction(() => document.querySelector('#loading')?.hasAttribute('hidden'), null, {
      timeout: 60_000,
    });
    await page.waitForTimeout(1500);
    await page.addStyleTag({
      content:
        'header, #toolbar, #hud, #nav-hint, #panel, .toast-stack, #empty, #problem, #loading { display: none !important; }',
    });
    const png = await page.locator('#view').screenshot({ type: 'png' });
    const out = `public/samples/thumbs/${id}.webp`;
    await sharp(png).resize(192, 144).webp({ quality: 70 }).toFile(out);
    console.log(out);
  }
  await browser.close();
} finally {
  preview.kill('SIGTERM');
}
