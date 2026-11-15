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

// Replaces the options of a <select>, keeping its first `keep` fixed options
// ("No crew", "Keep current crew"...), so reloading never duplicates them.
function fillSelect(select, items, keep) {
  select.length = keep;
  for (const [value, label] of items) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }
}

// Every crew list on the page: Create profile, Create mission and Move member
async function loadCrewOptions() {
  const { data, error } = await supabaseClient.from("crews").select("id, name").order("id");
  if (error) return console.error("crews:", error.message);
  const items = data.map((crew) => [crew.id, crew.name ? `${crew.id} · ${crew.name}` : crew.id]);
  fillSelect(crewSelect, items, 1);                                  // No crew
  fillSelect(document.getElementById("cm-crew"), items, 1);          // No crew
  fillSelect(document.getElementById("mv-crew"), items, 2);          // Keep / No crew
}

// Missions for Move member (MSN-... · name)
async function loadMissionOptions() {
  const { data, error } = await supabaseClient.from("missions").select("code, name").order("code");
  if (error) return console.error("missions:", error.message);
  const items = data.map((m) => [m.code, m.name ? `${m.code} · ${m.name}` : m.code]);
  fillSelect(document.getElementById("mv-mission"), items, 2);       // Keep / No mission
}

// Astronauts (ASP / LDR) for Move member
async function loadPeopleOptions() {
  const { data, error } = await supabaseClient
    .from("profiles")
    .select("astronaut_code, name, crew_id")
    .neq("role", "admin")
    .not("astronaut_code", "is", null)
    .order("astronaut_code");
  if (error) return console.error("people:", error.message);
  const items = data.map((p) => [
    p.astronaut_code,
    `${p.astronaut_code} · ${p.name || ""} · ${p.crew_id || "no crew"}`,
  ]);
  fillSelect(document.getElementById("mv-person"), items, 1);        // Choose an astronaut
}

// Keeps a fixed prefix (ASTRA-, MSN-) in front of what is typed, in capitals
function keepPrefix(input, prefix) {
  const value = input.value.toUpperCase();
  let i = 0;
  while (i < prefix.length && value[i] === prefix[i]) i++;           // skip the (partial) prefix
  input.value = prefix + value.slice(i).replace(/[^A-Z0-9]/g, "");
}

// POST to our API with the admin's token; returns the JSON or throws the server's message
async function postAdmin(path, body) {
  const token = await getAccessToken();
  if (!token) throw new Error("Your session expired. Log in again.");
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await readError(response));
  return response.json();
}

function setMsg(id, text, type) {
  const msg = document.getElementById(id);
  msg.textContent = text;
  msg.className = "form-msg" + (type ? " " + type : "");
}

const NETWORK_ERROR = "Could not reach the server. Is uvicorn running?";

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
    await Promise.all([loadCrewGrid(), loadPeopleOptions()]);  // show the new person everywhere
  } catch (error) {
    // Network error (server off / offline) or the server's message, shown as text
    setFormMsg(error instanceof TypeError ? "Could not reach the server. Is uvicorn running?" : error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

// ================= CREATE CREW =================
// Calls POST /admin/crews on our FastAPI server with the admin's own token.
// The server and the database (RLS) both check that the user is an admin.

// Every crew ID starts with ASTRA- (migration 015), like profile IDs start with ASP-/LDR-/ADM-
const CREW_PREFIX = "ASTRA-";
const CREW_ID_PATTERN = /^ASTRA-[A-Z0-9]{1,14}$/;
const crewForm = document.getElementById("create-crew-form");
const crewIdInput = document.getElementById("cc-id");

// Keep the ASTRA- prefix: whatever is typed after it stays, the prefix comes back if deleted
crewIdInput.addEventListener("input", () => keepPrefix(crewIdInput, CREW_PREFIX));

function setCrewMsg(text, type) {
  const msg = document.getElementById("cc-msg");
  msg.textContent = text;
  msg.className = "form-msg" + (type ? " " + type : "");
}

crewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const body = {
    id: document.getElementById("cc-id").value.trim().toUpperCase(),
    name: document.getElementById("cc-name").value.trim(),
  };

  if (!CREW_ID_PATTERN.test(body.id)) {
    return setCrewMsg("The crew ID looks like ASTRA-B (ASTRA- + 1 to 14 capitals or digits).", "error");
  }
  if (!body.name) return setCrewMsg("Enter a crew name.", "error");

  const submit = document.getElementById("cc-submit");
  submit.disabled = true;
  setCrewMsg("Creating...");
  try {
    const token = await getAccessToken();
    if (!token) throw new Error("Your session expired. Log in again.");

    const response = await fetch(`${API_URL}/admin/crews`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(await readError(response));

    const created = await response.json();
    setCrewMsg(`Created ${created.id}. Now create its leader (LDR) in "Create profile".`, "ok");
    crewForm.reset();  // the ID goes back to its default value, "ASTRA-"

    // Ready for the next step: the new crew selected and the role set to leader
    await loadCrewOptions();  // also refreshes Create mission and Move member
    roleSelect.value = "leader";
    onRoleChange();
    crewSelect.value = created.id;
  } catch (error) {
    setCrewMsg(error instanceof TypeError ? "Could not reach the server. Is uvicorn running?" : error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

// ================= CREATE MISSION =================
// Calls POST /admin/missions with the admin's own token. Every mission ID
// starts with MSN- (migration 016). With a crew, its members join automatically.

const MISSION_PREFIX = "MSN-";
const MISSION_CODE_PATTERN = /^MSN-[A-Z0-9]{1,14}$/;
const missionForm = document.getElementById("create-mission-form");
const missionCodeInput = document.getElementById("cm-code");
missionCodeInput.addEventListener("input", () => keepPrefix(missionCodeInput, MISSION_PREFIX));

missionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const launchDate = document.getElementById("cm-launch").value;  // yyyy-mm-dd
  const body = {
    code: missionCodeInput.value.trim().toUpperCase(),
    name: document.getElementById("cm-name").value.trim(),
    mission_type: document.getElementById("cm-type").value,
    launch_at: launchDate ? `${launchDate}T12:00:00Z` : "",          // noon UTC of that day
    crew_id: document.getElementById("cm-crew").value || null,
  };

  if (!MISSION_CODE_PATTERN.test(body.code)) {
    return setMsg("cm-msg", "The mission ID looks like MSN-03 (MSN- + 1 to 14 capitals or digits).", "error");
  }
  if (!body.name) return setMsg("cm-msg", "Enter a mission name.", "error");
  if (!launchDate) return setMsg("cm-msg", "Choose the launch date.", "error");

  const submit = document.getElementById("cm-submit");
  submit.disabled = true;
  setMsg("cm-msg", "Creating...");
  try {
    const created = await postAdmin("/admin/missions", body);
    const until = created.planned_return_at.slice(0, 10);
    setMsg("cm-msg",
      `Created ${created.code} (${created.mission_type}, until ${until}` +
      `${created.crew_id ? ", crew " + created.crew_id : ""}).`, "ok");
    missionForm.reset();  // the ID goes back to "MSN-"
    await loadMissionOptions();
  } catch (error) {
    setMsg("cm-msg", error instanceof TypeError ? NETWORK_ERROR : error.message, "error");
  } finally {
    submit.disabled = false;
  }
});

// ================= MOVE MEMBER =================
// Calls POST /admin/move. Only what changes is sent: "Keep ..." sends nothing,
// "No crew" / "No mission" sends null (leave). Leaders and crew cannot move people.

const moveForm = document.getElementById("move-member-form");

moveForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const person = document.getElementById("mv-person").value;
  const crew = document.getElementById("mv-crew").value;
  const mission = document.getElementById("mv-mission").value;

  if (!person) return setMsg("mv-msg", "Choose an astronaut.", "error");
  const body = { astronaut_code: person };
  if (crew !== "__keep__") body.crew_id = crew || null;
  if (mission !== "__keep__") body.mission_code = mission || null;
  if (!("crew_id" in body) && !("mission_code" in body)) {
    return setMsg("mv-msg", "Choose a new crew and/or a new mission.", "error");
  }

  const submit = document.getElementById("mv-submit");
  submit.disabled = true;
  setMsg("mv-msg", "Moving...");
  try {
    const moved = await postAdmin("/admin/move", body);
    setMsg("mv-msg",
      `${moved.astronaut_code}: crew ${moved.crew_id || "none"}, ` +
      `missions ${moved.missions.length ? moved.missions.join(", ") : "none"}.`, "ok");
    moveForm.reset();
    await Promise.all([loadCrewGrid(), loadPeopleOptions()]);
  } catch (error) {
    setMsg("mv-msg", error instanceof TypeError ? NETWORK_ERROR : error.message, "error");
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
  await Promise.all([loadCrewGrid(), loadCrewOptions(), loadMissionOptions(), loadPeopleOptions()]);
})();
