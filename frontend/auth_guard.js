// =====================================================================
// Session + role guard for private pages.
// Include it in <head>, AFTER supabase_client.js:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="supabase_client.js"></script>
//   <script src="auth_guard.js"></script>
// Then the page script calls it once and uses the profile it returns:
//   const profile = await requireRole(["crew", "leader"]);
//   if (!profile) return;   // already redirecting
//
// Wrong role -> ROLE_HOME of that role (crew/leader -> principal_page.html,
// admin -> admi.html). No session -> index.html.
//
// Note: this is only a UX gate. The real security is Supabase RLS and the
// API token: a user who skips this page still only gets the rows RLS allows.
// =====================================================================

// Hide the page until the role is confirmed, so private content never flashes.
document.documentElement.style.visibility = "hidden";

let roleCheck = null;  // memoized: every call on the page shares one check

function requireRole(allowedRoles) {
  if (!roleCheck) roleCheck = checkRole(allowedRoles);
  return roleCheck;
}

async function checkRole(allowedRoles) {
  try {
    const profile = await getProfile();

    if (!profile) {
      location.replace("index.html");
      return null;
    }

    if (Array.isArray(allowedRoles) && !allowedRoles.includes(profile.role)) {
      const home = ROLE_HOME[profile.role] || "index.html";
      // Never redirect to the same page (would loop)
      location.replace(location.pathname.endsWith(home) ? "index.html" : home);
      return null;
    }

    document.documentElement.style.visibility = "";
    return profile;
  } catch (err) {
    console.error("Auth guard error:", err);
    location.replace("index.html");
    return null;
  }
}
