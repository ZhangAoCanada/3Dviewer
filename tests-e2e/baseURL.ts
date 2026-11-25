/** One origin for the managed preview, fixtures and tests owning separate browsers. */
export const E2E_PORT = Number(process.env.OV_E2E_PORT ?? '4173');
if (!Number.isInteger(E2E_PORT) || E2E_PORT < 1 || E2E_PORT > 65535) {
  throw new Error('OV_E2E_PORT must be an integer TCP port between 1 and 65535.');
}
export const VIEWER_BASE_URL = `http://127.0.0.1:${E2E_PORT}/3Dviewer/`;
