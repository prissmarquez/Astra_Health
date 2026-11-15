
const NAV_ITEMS = [
  { label: "Home",     href: "principal_page.html" },
  { label: "History",  href: "historical.html" },
  { label: "Check-in", href: "checkin.html" },
  { label: "Body",     href: "BodyAi.html" },
  { label: "Sensors",  href: "sensors.html" },
  { label: "Settings", href: null }  // not built yet
];

// Pages that belong to another tab (the PANAS questionnaire is part of the check-in)
const NAV_ACTIVE_ALIAS = { "panas.html": "checkin.html" };

function insertNav() {
  const header = document.querySelector("header.header");
  if (!header || document.querySelector("nav.nav")) return;  // no header, or already there

  const page = location.pathname.split("/").pop() || "principal_page.html";
  const activeHref = NAV_ACTIVE_ALIAS[page] || page;

  const nav = document.createElement("nav");
  nav.className = "card nav";
  nav.setAttribute("aria-label", "Main navigation");

  NAV_ITEMS.forEach(function (item) {
    const link = document.createElement("a");
    link.textContent = item.label;
    if (item.href) link.href = item.href;
    if (item.href === activeHref) {
      link.className = "activo";
      link.setAttribute("aria-current", "page");
    }
    nav.appendChild(link);
  });

  header.after(nav);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", insertNav);
} else {
  insertNav();
}
