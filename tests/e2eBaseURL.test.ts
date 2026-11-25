import { afterEach, expect, it, vi } from 'vitest';
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it('keeps managed preview and owned-browser fixture URLs on the same validated port', async () => {
  vi.stubEnv('OV_E2E_PORT', '4216');
  vi.resetModules();
  const isolated = await import('../tests-e2e/baseURL');
  expect(isolated.E2E_PORT).toBe(4216);
  expect(new URL('bad.ply', isolated.VIEWER_BASE_URL).href).toBe('http://127.0.0.1:4216/3Dviewer/bad.ply');
});
it('rejects invalid or out-of-range ports instead of constructing shell fragments', async () => {
  for (const port of ['0', '65536', '4.5', 'abc', '4216;echo bad']) {
    vi.stubEnv('OV_E2E_PORT', port); vi.resetModules();
    await expect(import('../tests-e2e/baseURL')).rejects.toThrow('integer TCP port');
  }
});
