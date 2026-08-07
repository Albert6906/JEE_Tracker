const CACHE_NAME = "jee-tracker-v2.0.0";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/variables.css",
  "./css/base.css",
  "./css/components.css",
  "./css/charts.css",
  "./js/utils.js",
  "./js/storage.js",
  "./js/timer.js",
  "./js/notifications.js",
  "./js/planner.js",
  "./js/history.js",
  "./js/sleep.js",
  "./js/syllabus.js",
  "./js/mocktest.js",
  "./js/youtube.js",
  "./js/charts.js",
  "./js/reports.js",
  "./js/backup.js",
  "./js/firebase-sync.js",
  "./js/ui.js",
  "./js/main.js",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle same-origin GET requests. Everything else (Firebase,
  // YouTube API, Google Fonts, the Cloudflare email Worker) goes straight
  // to the network untouched.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;

      return fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => {
          if (req.mode === "navigate") return caches.match("./index.html");
        });
    })
  );
});
