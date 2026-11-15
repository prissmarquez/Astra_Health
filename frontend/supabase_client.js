// Shared Supabase client for every page.
// The publishable key is meant for the browser: on its own it can't read
// anything, RLS decides what each signed-in user sees. NEVER put the secret key here.
const SUPABASE_URL = "https://oswgtubikjlzavaxliuv.supabase.co";   // same as SUPABASE_URL in .env
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_2bsjmdVdRpEanb76wEdzcg_cd5NHr1J";    // same as in .env
const API_URL = "http://127.0.0.1:8000";                   // our FastAPI server

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

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
    localStorage.removeItem(PROFILE_KEY);
    CHECKIN_DRAFT_KEYS.forEach(function (key) { sessionStorage.removeItem(key); });
  } catch (error) {
    // Storage blocked: nothing saved to clear
  }

  window.location.href = "index.html";
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
