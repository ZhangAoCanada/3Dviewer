// Runs inside the generated service worker.
// A page that can show the Reload toast answers UPDATE_AVAILABLE. If none do,
// this install is replacing the old autoUpdate worker, so activate immediately
// and let that page reload itself.
const REPLY_MS = 1000;

self.addEventListener('install', (event) => {
  event.waitUntil(waitForToastOrClaim());
});

async function waitForToastOrClaim() {
  if (!self.registration.active) {
    await self.skipWaiting();
    return;
  }
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const replies = await Promise.all(windows.map(clientCanPrompt));
  if (!replies.some(Boolean)) await self.skipWaiting();
}

function clientCanPrompt(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(false), REPLY_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data === 'HAS_TOAST');
    };
    client.postMessage({ type: 'UPDATE_AVAILABLE' }, [channel.port2]);
  });
}
