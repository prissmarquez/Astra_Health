// =====================================================================
// Session guard for private pages.
// Include it in <head>, AFTER supabase_client.js:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="supabase_client.js"></script>
//   <script src="auth_guard.js"></script>
// For an admin-only page, set the required role BEFORE this script:
//   <script>window.REQUIRE_ROLE = "admin";</script>
//
// Note: this is only a UX gate. The real security is Supabase RLS and the
// API token: without a session the database returns nothing anyway.
// =====================================================================

// Hide the page until the session is confirmed, so private content never flashes.
document.documentElement.style.visibility = "hidden";

(async function () {
  try {
    const profile = await getProfile();

    // No session -> back to the login screen.
    if (!profile) {
      location.replace("index.html");
      return;
    }

    // Wrong role for this page (e.g. a crew member opening an admin page).
    if (window.REQUIRE_ROLE && profile.role !== window.REQUIRE_ROLE) {
      location.replace(ROLE_HOME[profile.role] || "index.html");
      return;
    }

    // Allowed: show the page.
    document.documentElement.style.visibility = "";
  } catch (err) {
    console.error("Auth guard error:", err);
    location.replace("index.html");
  }
})();
