

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
