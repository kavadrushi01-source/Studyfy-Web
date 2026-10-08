// Studyfy service worker (§7 Phase 3 #20 — PWA/offline-first, v1).
// Hand-written, no workbox dependency. Three versioned caches:
//
// - STUDYFY_STATIC: immutable Next chunks (/_next/static/...) —
//   cache-first, they never change under a build.
// - STUDYFY_PAGES: navigations — network-first, fall back to the cached
//   copy of that page, then to the precached /offline shell.
// - STUDYFY_API: GET API reads only — network-first with cache fallback so
//   a dropped connection still shows last-known data. The API lives on its
//   own origin, which the worker still sees because the calls originate
//   from controlled pages (CORS responses cache normally). POSTs,
//   Socket.io, and auth traffic are never cached or served stale.
//
// Offline-first here means: installable + the shell survives a dead
// connection. It does NOT mean offline writes — marking attendance or
// paying fees still needs the network (queued background sync is an
// explicit non-goal for this pass).
/* global self:readonly, caches:readonly, fetch:readonly, URL:readonly */
const STATIC_CACHE = "studyfy-static-v1";
const PAGES_CACHE = "studyfy-pages-v1";
const API_CACHE = "studyfy-api-v1";
const PRECACHE = ["/offline", "/manifest.webmanifest", "/icon-192.png"];
const API_MAX_ENTRIES = 50;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  const current = new Set([STATIC_CACHE, PAGES_CACHE, API_CACHE]);
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => !current.has(n)).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

function isApiRead(url, method) {
  return method === "GET" && url.pathname.startsWith("/api/");
}

function isStaticAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

function isSocket(url) {
  return url.pathname.startsWith("/socket.io/");
}

async function pruneApiCache() {
  const cache = await caches.open(API_CACHE);
  const keys = await cache.keys();
  if (keys.length > API_MAX_ENTRIES) {
    await cache.delete(keys[0]);
  }
}

async function networkFirst(request, cacheName, fallback) {
  try {
    const live = await fetch(request);
    const copy = live.clone();
    caches.open(cacheName).then((cache) => {
      cache.put(request, copy).then(() => {
        if (cacheName === API_CACHE) {
          pruneApiCache();
        }
      });
    });
    return live;
  } catch (err) {
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    if (fallback) {
      return fallback();
    }
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }
  const url = new URL(request.url);
  if (isSocket(url)) {
    return;
  }
  // The API lives on its own origin (Render in prod, :4001 locally) while
  // the app calls it directly — the worker still sees those fetches because
  // they originate from a controlled page. Only /api/ reads from any origin
  // are handled; every other cross-origin request is left alone.
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !isApiRead(url, request.method)) {
    return;
  }
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((live) => {
            const copy = live.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            return live;
          }),
      ),
    );
    return;
  }
  if (isApiRead(url, request.method)) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, PAGES_CACHE, () => caches.match("/offline")));
  }
});
