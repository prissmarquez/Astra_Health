// ===== ASTRA HEALTH - Service worker =====
// Keeps a copy of the front-end files so the app opens without internet.
// Strategy: network-first (fresh file when online, cached copy when offline).
// API calls (FastAPI /sync, /analysis) and Supabase are NEVER cached.

const CACHE_NAME = "astra-cache-v2";  // change the version to drop old copies

const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

// Every HTML, CSS and JS file of frontend/ (+ images). Missing files are skipped.
const APP_FILES = [
  "./",
  // Pages
  "BodyAi.html",
  "admi.html",
  "ast_checkin.html",
  "checkin.html",
  "historical.html",
  "history_admi.html",
  "index.html",
  "panas.html",
  "principal_page.html",
  "sensors.html",
  // Styles
  "BodyAi_style.css",
  "admi.css",
  "astro_in.css",
  "checkin.css",
  "historial.css",
  "panas.css",
  "sensors.css",
  "style_login.css",
  "styles.css",
  // Scripts
  "admi.js",
  "auth_guard.js",
  "checkin.js",
  "panas.js",
  "principal_page.js",
  "script_BodyAi.js",
  "script_admi.js",
  "script_astroin.js",
  "script_historical.js",
  "script_login.js",
  "sensors.js",
  "supabase_client.js",
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

// Paths of our FastAPI server: always go to the network
const API_PATHS = ["/sync", "/analysis"];

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
          return caches.match("index.html");
        }
        return new Response("Offline", { status: 503, statusText: "Offline" });
      });
    })
  );
});
