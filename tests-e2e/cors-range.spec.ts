import { expect, test } from './test';
import { createServer, type Server } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import ts from 'typescript';

let server: Server;
let origin: string;
const requests: { method: string; mode: string; ifRange?: string | string[] }[] = [];
test.use({ serviceWorkers: 'block', mockRelease: false });
test.beforeAll(async () => {
  const module = ts.transpileModule(await readFile(process.env.OV_CORS_READER ?? 'src/core/byteSource.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const scene = await readFile('public/samples/torus.ply');
  server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fixture.invalid');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    if (url.pathname === '/reader.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(module); return; }
    const mode = url.searchParams.get('mode') ?? 'none';
    requests.push({ method: req.method ?? '', mode, ifRange: req.headers['if-range'] });
    if (req.method === 'OPTIONS') {
      if (mode === 'permitted') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD');
        res.setHeader('Access-Control-Allow-Headers', 'If-Range, Range');
        res.writeHead(204).end();
      } else res.writeHead(405).end();
      return;
    }
    const body = mode === 'scene' ? scene : Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, ETag, Accept-Ranges');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/octet-stream');
    if (mode === 'modified' || mode === 'scene') res.setHeader('Last-Modified', 'Thu, 19 Nov 2026 12:00:00 GMT');
    else if (mode !== 'none') res.setHeader('ETag', mode === 'weak' ? 'W/"v1"' : mode === 'changed' && req.headers.range === 'bytes=4-7' ? '"v2"' : '"v1"');
    if (req.method === 'HEAD') { res.setHeader('Content-Length', body.length); res.end(); return; }
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    if (!range) { res.setHeader('Content-Length', body.length); res.end(body); return; }
    const start = Number(range[1]); const end = Math.min(Number(range[2]), body.length - 1);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`);
    res.setHeader('Content-Length', end - start + 1);
    res.writeHead(206).end(body.subarray(start, end + 1));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  origin = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
test.afterEach(async ({ page }, info) => { await writeFile(info.outputPath('requests.json'), JSON.stringify({ page: page.url(), requests }, null, 2)); });
test.beforeEach(async ({ page }) => {
  requests.length = 0;
  await page.addInitScript(() => {
    Object.defineProperty(navigator.serviceWorker, 'ready', { value: Promise.resolve() });
    localStorage.setItem('3dviewer-release', JSON.stringify({ tag: 'v0.3.0', at: Date.now() }));
  });
});
for (const mode of ['strong', 'modified', 'weak', 'none', 'permitted', 'changed']) {
  test(`real two-origin range reads: ${mode}`, async ({ page }, info) => {
    await page.goto('/');
    const result = await page.evaluate(async ({ origin, mode }) => {
      const { rangeSource } = await import(`${origin}/reader.js`);
      const source = rangeSource(`${origin}/bytes?mode=${mode}`, 8, new AbortController().signal);
      try {
        const first = Array.from(new Uint8Array(await source.read(0, 4)));
        const second = Array.from(new Uint8Array(await source.read(4, 8)));
        return { bytes: [...first, ...second], error: null };
      } catch (error) { return { bytes: [], error: String(error) }; }
    }, { origin, mode });
    await info.attach('real-server-requests', { body: JSON.stringify(requests), contentType: 'application/json' });
    if (mode === 'changed') expect(result.error).toContain('validator changed');
    else expect(result).toEqual({ bytes: [1, 2, 3, 4, 5, 6, 7, 8], error: null });
    expect(requests.filter((r) => r.method === 'GET')).toHaveLength(2);
    expect(requests.some((r) => r.ifRange !== undefined)).toBe(false);
  });
}
test('real CORS host explicitly permitting If-Range is a valid fixture', async ({ page }) => {
  await page.goto('/');
  const status = await page.evaluate(async (url) => (await fetch(url, { headers: { Range: 'bytes=0-3', 'If-Range': '"v1"' } })).status, `${origin}/bytes?mode=permitted`);
  expect(status).toBe(206); expect(requests.some((r) => r.method === 'OPTIONS')).toBe(true);
});
test('application imports ranged Gaussian scene from simple-CORS Last-Modified host', async ({ page }) => {
  await page.goto('/?url=' + encodeURIComponent(`${origin}/torus.ply?mode=scene`));
  await expect(page.locator('#file-name')).toHaveText('torus.ply');
  await expect(page.locator('#problem')).toBeHidden();
  expect(requests.some((r) => r.method === 'OPTIONS')).toBe(false);
  expect(requests.filter((r) => r.method === 'GET').length).toBeGreaterThan(2);
});
