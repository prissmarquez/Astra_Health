// Admin home: list every astronaut with their latest traffic light.
// Uses supabaseClient and getProfile from supabase_client.js.
// Admin RLS (migrations 002 + 010): the admin reads ALL profiles and analyses.

// traffic light -> CSS class and text already used in admi.html
const STATUS = {
  green:  { css: "optimal",   text: "Normal" },
  yellow: { css: "follow-up", text: "Follow-up" },
  red:    { css: "attention", text: "Needs attention" },
};

async function loadCrewGrid() {
  const grid = document.getElementById("crew-grid");
  grid.textContent = "";  // removes the example cards

  const { data: people, error } = await supabaseClient
    .from("profiles")
    .select("id, name, astronaut_code, role, crew_id")
    .neq("role", "admin")
    .order("crew_id")
    .order("astronaut_code");
  if (error) return console.error("profiles:", error.message);

  // Latest analysis per astronaut (newest first, keep the first one we see)
  const { data: analyses } = await supabaseClient
    .from("health_analyses")
    .select("astronaut_id, traffic_light, analyzed_at")
    .order("analyzed_at", { ascending: false });
  const latest = {};
  for (const a of analyses || []) {
    if (!latest[a.astronaut_id]) latest[a.astronaut_id] = a.traffic_light;
  }

  if (people.length === 0) {
    grid.textContent = "No astronauts yet.";
    return;
  }

  for (const p of people) {
    const card = document.createElement("a");
    card.className = "crew-card";
    card.href = `history_admi.html?id=${encodeURIComponent(p.id)}`;

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.textContent = (p.name || p.astronaut_code || "?")[0].toUpperCase();

    const name = document.createElement("strong");
    name.textContent = p.name || p.astronaut_code;

    const info = document.createElement("small");
    info.textContent = `${p.astronaut_code || ""} · ${p.role} · ${p.crew_id || "no crew"}`;

    const status = document.createElement("span");
    const s = STATUS[latest[p.id]];
    status.className = `estado ${s ? s.css : ""}`;
    status.textContent = s ? `● ${s.text}` : "● No check-in yet";

    card.append(avatar, name, info, status);
    grid.appendChild(card);
  }
}

connectLogoutButton();  // from supabase_client.js

(async function () {
  const profile = await getProfile();
  if (!profile || profile.role !== "admin") {
    window.location.href = "index.html";  // only admins can be here
    return;
  }
  document.getElementById("nombre-usuario").textContent = profile.name || profile.astronaut_code;
  document.getElementById("rol-usuario").textContent = `${profile.astronaut_code} · Administrator`;
  await loadCrewGrid();
})();
