// ===== ASTRA HEALTH - Service worker =====
// Keeps a copy of the front-end files so the app opens without internet.
// Strategy: network-first (fresh file when online, cached copy when offline).
// API calls (FastAPI /sync, /analysis, /body, ...) and Supabase are NEVER cached.

const CACHE_NAME = "astra-cache-v6";  // change the version to drop old copies

const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

// Every HTML (pages/), CSS (style/) and JS (services/) file of frontend/ (+ images). Missing files are skipped.
const APP_FILES = [
  "./",
  // Pages
  "pages/BodyAi.html",
  "pages/admi.html",
  "pages/ast_checkin.html",
  "pages/checkin.html",
  "pages/historical.html",
  "pages/history_admi.html",
  "pages/index.html",
  "pages/panas.html",
  "pages/principal_page.html",
  "pages/sensors.html",
  // Styles
  "style/BodyAi_style.css",
  "style/admi.css",
  "style/astro_in.css",
  "style/checkin.css",
  "style/historial.css",
  "style/panas.css",
  "style/sensors.css",
  "style/style_login.css",
  "style/styles.css",
  // Scripts
  "services/admi.js",
  "services/auth_guard.js",
  "services/ble_codec.js",
  "services/checkin.js",
  "services/nav.js",
  "services/panas.js",
  "services/principal_page.js",
  "services/script_BodyAi.js",
  "services/script_admi.js",
  "services/script_astroin.js",
  "services/script_historical.js",
  "services/script_login.js",
  "services/sensors.js",
  "services/supabase_client.js",
  // Images
  "assets/BP.jpg",
  "assets/background.jpg",
  "assets/background_login.webp",
  "assets/gluco.png",
  "assets/log_nasa.png",
  "assets/oxigen.png",
  "assets/profile.png",
  "assets/recourse1.webp",
  "assets/recourse2.png",
  // Library
  SUPABASE_CDN
];

// Paths of our FastAPI server: always go to the network. In Railway the API
// shares the origin with these pages, so every API route must be listed here.
const API_PATHS = ["/sync", "/analysis", "/body", "/admin", "/health", "/docs", "/openapi.json"];

// ----- Install: cache every file, skipping the ones that fail -----
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return Promise.allSettled(APP_FILES.map(function (url) {
        return fetch(url, { cache: "no-cache" }).then(function (response) {
          if (!response.ok) throw new Error(url + " -> " + response.status);
          return cache.put(url, response);
        });
      })).then(function (results) {
        results.forEach(function (result) {
          if (result.status === "rejected") {
            console.warn("[sw] skipped:", result.reason && result.reason.message);
          }
        });
      });
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// ----- Activate: delete old caches and control open pages right away -----
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names
        .filter(function (name) { return name !== CACHE_NAME; })
        .map(function (name) { return caches.delete(name); }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Only our own files and the Supabase library are cached
function isCacheable(request) {
  if (request.method !== "GET") return false;
  const url = new URL(request.url);

  if (url.hostname.endsWith("supabase.co")) return false;           // Supabase API
  if (API_PATHS.some(function (p) { return url.pathname.startsWith(p); })) return false;  // FastAPI
  if (request.url === SUPABASE_CDN) return true;                    // library on the CDN
  return url.origin === self.location.origin;                       // our HTML/CSS/JS/images
}

// ----- Fetch: network-first -----
self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (!isCacheable(request)) return;  // not handled: goes straight to the network

  event.respondWith(
    fetch(request).then(function (response) {
      // Save a fresh copy (opaque = CDN script loaded without CORS, still usable)
      if (response.ok || response.type === "opaque") {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(request, copy);
        });
      }
      return response;
    }).catch(function () {
      // Offline: use the cached copy (ignore ?id=... in history links)
      return caches.match(request, { ignoreSearch: true }).then(function (cached) {
        if (cached) return cached;
        if (request.mode === "navigate") {
          return caches.match("pages/index.html");
        }
        return new Response("Offline", { status: 503, statusText: "Offline" });
      });
    })
  );
});
