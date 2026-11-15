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

// ================= CREATE PROFILE =================
// Calls POST /admin/users on our FastAPI server (API_URL). The server checks the
// token belongs to an admin and creates the account with the SECRET key, which
// never reaches the browser.

// The ID prefix decides the role (migration 012)
const ROLE_PREFIX = { crew: "ASP", leader: "LDR", admin: "ADM" };
const CODE_PATTERN = /^(ASP|LDR|ADM)-[0-9]{4}$/;

const userForm = document.getElementById("create-user-form");
const roleSelect = document.getElementById("cu-role");
const codeInput = document.getElementById("cu-code");
const crewSelect = document.getElementById("cu-crew");

function setFormMsg(text, type) {
  const msg = document.getElementById("cu-msg");
  msg.textContent = text;
  msg.className = "form-msg" + (type ? " " + type : "");
}

async function loadCrewOptions() {
  const { data, error } = await supabaseClient.from("crews").select("id, name").order("id");
  if (error) return console.error("crews:", error.message);
  for (const crew of data) {
    const option = document.createElement("option");
    option.value = crew.id;
    option.textContent = crew.name ? `${crew.id} · ${crew.name}` : crew.id;
    crewSelect.appendChild(option);
  }
}

// Role changes the ID prefix and admins never join a crew
function onRoleChange() {
  const prefix = ROLE_PREFIX[roleSelect.value];
  const digits = (codeInput.value.match(/[0-9]{1,4}$/) || [""])[0];
  codeInput.placeholder = prefix + "-1004";
  codeInput.value = prefix + "-" + digits;  // always starts with the role's prefix; keep typed digits
  crewSelect.disabled = roleSelect.value === "admin";
  if (crewSelect.disabled) crewSelect.value = "";
}

// FastAPI errors: { detail: "text" } or { detail: [{ msg, loc }] } (validation)
async function readError(response) {
  try {
    const body = await response.json();
    if (typeof body.detail === "string") return body.detail;
    if (Array.isArray(body.detail)) {
      return body.detail.map((d) => `${(d.loc || []).slice(-1)[0]}: ${d.msg}`).join("; ");
    }
  } catch (error) {
    // not JSON
  }
  return `Server error (${response.status})`;
}

roleSelect.addEventListener("change", onRoleChange);

userForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const role = roleSelect.value;
  const body = {
    name: document.getElementById("cu-name").value.trim(),
    code: codeInput.value.trim().toUpperCase(),
    password: document.getElementById("cu-password").value,
    role: role,
    crew_id: role === "admin" ? null : crewSelect.value || null,
  };

  if (!body.name) return setFormMsg("Enter a name.", "error");
  if (!CODE_PATTERN.test(body.code)) return setFormMsg("The ID must look like ASP-0000, LDR-0000 or ADM-0000.", "error");
  if (!body.code.startsWith(ROLE_PREFIX[role] + "-")) {
    return setFormMsg(`A ${role} ID starts with ${ROLE_PREFIX[role]}-.`, "error");
  }
  if (body.password.length < 8) return setFormMsg("The password needs at least 8 characters.", "error");

  const submit = document.getElementById("cu-submit");
  submit.disabled = true;
  setFormMsg("Creating...");
  try {
    const token = await getAccessToken();
    if (!token) throw new Error("Your session expired. Log in again.");

    const response = await fetch(`${API_URL}/admin/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await readError(response));

    const created = await response.json();
    setFormMsg(
      `Created ${created.astronaut_code} (${created.role}${created.crew_id ? ", " + created.crew_id : ""}). ` +
      `They can log in with this ID and password.`,
      "ok"
    );
    userForm.reset();
    onRoleChange();
    await loadCrewGrid();  // show the new person
  } catch (error) {
    // Network error (server off / offline) or the server's message, shown as text
    setFormMsg(error instanceof TypeError ? "Could not reach the server. Is uvicorn running?" : error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

connectLogoutButton();  // from supabase_client.js

(async function () {
  const profile = await requireRole(["admin"]);  // auth_guard.js: others -> principal_page.html
  if (!profile) return;
  document.getElementById("nombre-usuario").textContent = profile.name || profile.astronaut_code;
  document.getElementById("rol-usuario").textContent = `${profile.astronaut_code} · Administrator`;
  onRoleChange();
  await Promise.all([loadCrewGrid(), loadCrewOptions()]);
})();
