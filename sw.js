/* Service worker: офлайн-оболочка приложения.
 * После изменений файлов увеличьте CACHE_VERSION — старый кэш удалится. */

const CACHE_VERSION = "avtozhurnal-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/api.js",
  "./js/api-demo.js",
  "./js/api-firebase.js",
  "./js/firebase-config.js",
  "./js/utils.js",
  "./js/stats.js",
  "./js/charts.js",
  "./vendor/firebase-app.js",
  "./vendor/firebase-auth.js",
  "./vendor/firebase-firestore.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-64.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(async (cache) => {
      await Promise.allSettled(
        ASSETS.map((asset) =>
          cache.add(new Request(asset, { cache: "reload" })).catch((error) => {
            console.warn("[SW] не удалось закэшировать", asset, error);
          })
        )
      );
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isCacheable(request, response) {
  if (!response || response.status !== 200) return false;
  if (request.method !== "GET") return false;
  const url = new URL(request.url);
  return url.origin === self.location.origin;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Firebase и прочие внешние API не кэшируем.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put("./index.html", copy)).catch(() => {});
          return response;
        })
        .catch(async () => {
          const cached = await caches.match("./index.html");
          return cached || new Response("Нет сети. Откройте приложение позже.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (isCacheable(request, response)) {
            const copy = response.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});
