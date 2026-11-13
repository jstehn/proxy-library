// Service worker for Proxy Library: precaches an offline fallback page and caches immutable
// card printing images up to 500 entries. Live drafts (SSE), wallet, and auth stay network-only.
const SHELL_CACHE = "shell-v1";
const IMAGE_CACHE = "images-v1";
const OFFLINE_URL = "/offline.html";
const MAX_IMAGE_ENTRIES = 500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL_CACHE, IMAGE_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheImageWithCap(request, response) {
  const cache = await caches.open(IMAGE_CACHE);
  await cache.put(request, response);
  const keys = await cache.keys();
  const excess = keys.length - MAX_IMAGE_ENTRIES;
  for (let index = 0; index < excess; index++) {
    await cache.delete(keys[index]);
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/images/")) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          event.waitUntil(cacheImageWithCap(request, response.clone()));
        }
        return response;
      }),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached ?? Response.error();
      }),
    );
  }
});
