import { expect, test } from './test';
test('cached HEAD and Range survive an actual cold worker restart offline', async ({ page, context }) => {
  await page.goto('/?sample=crate'); await expect(page.locator('#file-name')).toHaveText('crate.glb');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }));
  });
  const cdp = await context.newCDPSession(page);
  const workers = new Map<string, { status: string; runningStatus: string }>();
  cdp.on('ServiceWorker.workerVersionUpdated', ({ versions }) => { for (const version of versions) workers.set(version.versionId, version); });
  await cdp.send('ServiceWorker.enable'); await cdp.send('ServiceWorker.stopAllWorkers');
  await expect.poll(() => [...workers.values()].some((v) => v.status === 'activated' && v.runningStatus === 'stopped')).toBe(true);
  await context.setOffline(true);
  try {
    const result = await page.evaluate(async () => {
      const head = await fetch('/3Dviewer/samples/crate.glb', { method: 'HEAD' });
      const range = await fetch('/3Dviewer/samples/crate.glb', { headers: { Range: 'bytes=0-3' } });
      const missing = await fetch('/3Dviewer/__missing.ply', { headers: { Range: 'bytes=0-3' } }).then(() => 'unexpected response', () => 'network failure');
      return { head: head.status, size: Number(head.headers.get('content-length')), range: range.status, bytes: Array.from(new Uint8Array(await range.arrayBuffer())), missing };
    });
    expect(result).toMatchObject({ head: 200, range: 206, bytes: [103, 108, 84, 70], missing: 'network failure' }); expect(result.size).toBeGreaterThan(4);
  } finally { await context.setOffline(false); await cdp.detach(); }
});
