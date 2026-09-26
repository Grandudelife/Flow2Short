const CACHE_NAME = "flow2short-studio-v17";
const APP_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./favicon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/maskable-512.png",
  "./vendor/fonts/vazirmatn-arabic-400-normal.woff2",
  "./vendor/fonts/vazirmatn-arabic-600-normal.woff2",
  "./vendor/fonts/vazirmatn-arabic-700-normal.woff2",
  "./vendor/fonts/DejaVuSans.ttf",
  "./vendor/ffmpeg/classes.js",
  "./vendor/ffmpeg/const.js",
  "./vendor/ffmpeg/errors.js",
  "./vendor/ffmpeg/index.js",
  "./vendor/ffmpeg/types.js",
  "./vendor/ffmpeg/utils.js",
  "./vendor/ffmpeg/worker.js",
  "./vendor/core/ffmpeg-core.js",
  "./vendor/core/ffmpeg-core.wasm"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("flow2short-studio-") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", clone));
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // App code and styles must follow the installed Mac package, even on the same localhost port.
  if (/\/(app\.js|styles\.css)$/.test(requestUrl.pathname)) {
    event.respondWith(fetch(event.request, { cache: "no-store" }).then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }).catch(async () => (await caches.match(event.request)) || caches.match(`./${requestUrl.pathname.split("/").pop()}`)));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
      }
      return response;
    }))
  );
});
