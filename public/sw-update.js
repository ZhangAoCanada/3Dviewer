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

// Precache stores the decoded body but keeps the network's Content-Encoding and
// Content-Length. A Range GET then comes back as that full 200, which the
// gaussian loader rejects. Serve HEAD and Range from those cached bytes.
// Anything else must reach the network: claiming it and refetching from here
// hides a failed download and can return the HTML shell as status 200.
const precachePaths = new Set();

self.addEventListener('activate', (event) => {
  event.waitUntil(refreshPrecachePaths());
});

async function refreshPrecachePaths() {
  try {
    const names = await caches.keys();
    const next = new Set();
    for (const name of names) {
      if (!name.startsWith('workbox-precache-')) continue;
      const cache = await caches.open(name);
      for (const cached of await cache.keys()) {
        next.add(new URL(cached.url).pathname);
      }
    }
    precachePaths.clear();
    for (const path of next) precachePaths.add(path);
  } catch {
    /* Range requests then stay on the network. */
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'HEAD' && request.method !== 'GET') return;
  if (request.method === 'GET' && !request.headers.has('range')) return;
  let path = '';
  try {
    path = new URL(request.url).pathname;
  } catch {
    return;
  }
  if (!precachePaths.has(path)) return;
  if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
  event.respondWith(serveCachedBytes(request));
});

async function serveCachedBytes(request) {
  try {
    const cached = await caches.match(new Request(request.url, { method: 'GET' }), {
      ignoreSearch: true,
      ignoreVary: true,
    });
    if (!cached || cached.status !== 200) return fetch(request);
    if (new URL(cached.url || request.url).pathname !== new URL(request.url).pathname) return fetch(request);
    const blob = await cached.blob();
    const magic = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    if (magic.length >= 2 && magic[0] === 0x1f && magic[1] === 0x8b) return fetch(request);
    const headers = new Headers(cached.headers);
    headers.delete('content-encoding');
    headers.delete('content-length');
    headers.delete('content-range');
    headers.set('accept-ranges', 'bytes');
    headers.set('content-length', String(blob.size));
    if (request.method === 'HEAD') return new Response(null, { status: 200, statusText: 'OK', headers });
    const range = request.headers.get('range');
    if (!range) return new Response(blob, { status: 200, statusText: 'OK', headers });
    return partialResponse(range, blob, headers);
  } catch {
    return fetch(request);
  }
}

function partialResponse(rangeHeader, blob, headers) {
  const parsed = parseByteRange(rangeHeader, blob.size);
  if (!parsed) {
    return new Response(null, {
      status: 416,
      statusText: 'Range Not Satisfiable',
      headers: { 'content-range': `bytes */${blob.size}` },
    });
  }
  const sliced = blob.slice(parsed.start, parsed.end);
  const partHeaders = new Headers(headers);
  partHeaders.set('content-length', String(sliced.size));
  partHeaders.set('content-range', `bytes ${parsed.start}-${parsed.end - 1}/${blob.size}`);
  return new Response(sliced, { status: 206, statusText: 'Partial Content', headers: partHeaders });
}

function parseByteRange(rangeHeader, size) {
  const header = rangeHeader.trim();
  if (header.includes(',')) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!match || (match[1] === '' && match[2] === '')) return null;
  let start;
  let end;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size : Number(match[2]) + 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end <= start) return null;
  return { start, end: Math.min(end, size) };
}
