// Shared Supabase client for every page.
// The publishable key is meant for the browser: on its own it can't read
// anything, RLS decides what each signed-in user sees. NEVER put the secret key here.
const SUPABASE_URL = "https://oswgtubikjlzavaxliuv.supabase.co";   // same as SUPABASE_URL in .env
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_2bsjmdVdRpEanb76wEdzcg_cd5NHr1J";    // same as in .env
const API_URL = "http://127.0.0.1:8000";                   // our FastAPI server

// Page each role lands on after logging in.
// Change admin's page when the admin view exists.
const ROLE_HOME = {
  crew: "principal_page.html",
  leader: "principal_page.html",
  admin: "admi.html"
};

// ===== Offline support =====
const PROFILE_KEY = "astra_profile";  // last profile, used when there is no network
// Check-in draft saved by checkin.js / panas.js (cleared on logout)
const CHECKIN_DRAFT_KEYS = ["astra_measured", "astra_checkin_form", "panasResult"];
// Readings waiting for POST /sync. Each one has owner_id = the profile id that took it.
// Medical data: never cleared on logout.
const QUEUE_KEY = "astra_offline_queue";

function loadQueue() {
  try {
    const queue = JSON.parse(localStorage.getItem(QUEUE_KEY));
    return Array.isArray(queue) ? queue : [];
  } catch (error) {
    return [];
  }
}

function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
}

// Pending readings of the current user (uses the saved profile, so it works offline)
function countPendingReadings() {
  const profile = getCachedProfile();
  if (!profile) return 0;
  return loadQueue().filter(function (reading) {
    return reading && reading.owner_id === profile.id;
  }).length;
}

// ===== "Connected" indicator in the header =====
// Shows "Connected" / "Offline" and the user's pending readings, e.g. "Offline · 2 pending".
// Does nothing on pages without .conectado.
function updateConnectionStatus() {
  const indicators = document.querySelectorAll(".conectado");
  if (indicators.length === 0) return;

  const online = navigator.onLine;
  const pending = countPendingReadings();
  let text = online ? "Connected" : "Offline";
  if (pending > 0) text += " · " + pending + " pending";

  indicators.forEach(function (indicator) {
    const dot = document.createElement("span");
    dot.className = "punto";
    indicator.textContent = "";
    indicator.append(dot, " " + text);
    indicator.classList.toggle("offline", !online);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", updateConnectionStatus);
} else {
  updateConnectionStatus();
}
window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);

// Service worker: caches the pages so the app opens without internet.
// Every page loads this file, so registering here is enough.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function (error) {
      console.warn("Service worker not registered:", error);
    });
  });
}

function saveCachedProfile(profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch (error) {
    // Storage blocked: offline mode will not have a profile
  }
}

function getCachedProfile() {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY));
    return profile && typeof profile === "object" && profile.id ? profile : null;
  } catch (error) {
    return null;
  }
}

// True when a Supabase error was caused by the network, not by the data
function isNetworkError(error) {
  if (!navigator.onLine) return true;
  const message = String((error && error.message) || error || "");
  return /failed to fetch|network|load failed/i.test(message);
}

// Created after the offline helpers, so the indicator still works if the library failed to load
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

// Returns the signed-in user's profile ({ id, name, role, crew_id, astronaut_code }) or null.
// Without network it returns the last saved profile instead.
async function getProfile() {
  let session = null;
  try {
    const result = await supabaseClient.auth.getSession();
    session = result.data.session;
  } catch (error) {
    // Session could not be read/refreshed (usually offline)
  }

  if (!session) {
    // Offline and the session could not be refreshed: keep the user in the app
    return navigator.onLine ? null : getCachedProfile();
  }

  try {
    const { data, error } = await supabaseClient
      .from("profiles")
      .select("id, name, role, crew_id, astronaut_code")
      .eq("id", session.user.id)
      .single();

    if (!error && data) {
      saveCachedProfile(data);
      return data;
    }
    if (!isNetworkError(error)) return null;
  } catch (error) {
    if (!isNetworkError(error)) return null;
  }

  // No network: use the saved profile only if it belongs to this session
  const cached = getCachedProfile();
  return cached && cached.id === session.user.id ? cached : null;
}

// Logs out, even without internet, and goes back to the login page.
async function logout() {
  try {
    // signOut calls the server; don't wait more than 3 s when the network is bad
    await Promise.race([
      supabaseClient.auth.signOut(),
      new Promise(function (resolve) { setTimeout(resolve, 3000); })
    ]);
  } catch (error) {
    console.warn("Sign out without server:", error);
  }

  try {
    // Offline, signOut keeps the local session: remove Supabase's token by hand
    Object.keys(localStorage).forEach(function (key) {
      if (/^sb-.*-auth-token/.test(key)) localStorage.removeItem(key);
    });
    // The offline queue (QUEUE_KEY) is kept on purpose: it is uploaded when its owner logs in again
    localStorage.removeItem(PROFILE_KEY);
    CHECKIN_DRAFT_KEYS.forEach(function (key) { sessionStorage.removeItem(key); });
  } catch (error) {
    // Storage blocked: nothing saved to clear
  }

  window.location.href = "index.html";
}

// ===== Dates =====
// The database stores timestamps in UTC (timestamptz). The UI shows them in the
// browser's local time zone. Never cut ISO strings by hand: use these helpers.

// "2026-11-15T06:30:00Z" -> "Nov 15, 2026, 12:30 AM" (local time, browser locale)
function formatLocalDateTime(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Time only, e.g. "09:36" (local time)
function formatLocalTime(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

// Calendar days stored as `date` (daily_readings.day, health_analyses.day) are UTC
// days with no time: they are formatted in UTC so they never move to the day before.
// options: Intl.DateTimeFormat options, e.g. { month: "short", day: "numeric" }
function formatDay(day, options) {
  const date = new Date(day + "T00:00:00Z");
  if (!day || Number.isNaN(date.getTime())) return "--";
  // dateStyle cannot be combined with month/day options, so it is only the default
  const opts = Object.assign({}, options || { dateStyle: "medium" }, { timeZone: "UTC" });
  return new Intl.DateTimeFormat(undefined, opts).format(date);
}

// Date -> "YYYY-MM-DD" of that instant in UTC, for filtering `date` columns
function utcDay(date) {
  return date.getUTCFullYear() + "-" +
    String(date.getUTCMonth() + 1).padStart(2, "0") + "-" +
    String(date.getUTCDate()).padStart(2, "0");
}

// Shows the astronaut's name and "code · role" in the page header.
// Pages use two id styles (nombre-usuario / user-name); both are supported.
function fillUserHeader(profile) {
  if (!profile) return;
  const nameEl = document.getElementById("nombre-usuario") || document.getElementById("user-name");
  const roleEl = document.getElementById("rol-usuario") || document.getElementById("user-role");
  if (nameEl) nameEl.textContent = profile.name || profile.astronaut_code || "Astronaut";
  if (roleEl) roleEl.textContent = [profile.astronaut_code, profile.role].filter(Boolean).join(" · ");
}

// Connects #logout-btn on the current page (does nothing if the page has none)
function connectLogoutButton() {
  const button = document.getElementById("logout-btn");
  if (!button) return;
  button.addEventListener("click", function () {
    button.disabled = true;
    logout();
  });
}

// Token for calling our API: headers: { Authorization: "Bearer " + token }
async function getAccessToken() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session ? session.access_token : null;
}
