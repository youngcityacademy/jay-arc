const CACHE = "jay-arc-v10";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./data-store.js",
  "./auth.js",
  "./script.js",
  "./quotes.js",
  "./manifest.json",
  "./icon.svg",
  "./icon-192.svg",
  "./icon-512.svg",
  "./jay-arc-logo.png",
  "./jay-arc-logo-192.png",
  "./jay-arc-logo-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin ||
      url.pathname.endsWith("/supabase-config.js")) return;

  event.respondWith(
    caches.open(CACHE).then(cache => cache.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response.ok) {
          const copy = response.clone();
          void cache.put(request, copy);
        }
        return response;
      }).catch(() => {
        if (request.mode === "navigate") return cache.match("./index.html");
        throw new Error(`JAY ARC offline asset unavailable: ${request.url}`);
      });
    }))
  );
});
