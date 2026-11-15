const $ = (id) => document.getElementById(id);

// ================= DATA SOURCE (TEAMMATES EDIT HERE) =================
const REGISTER_API_URL = null;            // e.g. "http://localhost:3000/api"
const USE_SAMPLE_DATA = true;    // false when the real API works
const SLOTS = 4;

/**
 * saveMember(slot, { name, id, password, role }) -> { id, name, role }
 * The backend must HASH the password. It must never come back in the response.
 */
async function saveMember(slot, data) {
  if (USE_SAMPLE_DATA || !REGISTER_API_URL) {
    return { id: data.id, name: data.name, role: data.role };   // no password
  }
  const res = await fetch(`${REGISTER_API_URL}/crew`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slot, ...data }),
  });
  if (!res.ok) throw new Error("Status " + res.status);
  return res.json();
}

// ================= STATE =================
// Only public data is kept here. The password is never stored in the page.
const members = Array(SLOTS).fill(null);
let selected = 0;

// ================= SAFE DOM HELPER =================
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

// ================= RENDER =================
function renderSlots() {
  const box = $("slots");
  box.replaceChildren();
  members.forEach((m, i) => {
    const cls = ["slot", m ? "filled" : "", i === selected ? "active" : ""].join(" ").trim();
    const btn = el("button", { type: "button", class: cls, text: String(i + 1), "aria-label": `Member ${i + 1}` });
    btn.addEventListener("click", () => selectSlot(i));
    box.append(btn);
  });
}

function renderForm() {
  const m = members[selected];
  $("f-name").value = m ? m.name : "";
  $("f-id").value = m ? m.id : "";
  $("f-role").value = m ? m.role : "";
  $("f-pass").value = "";
  $("f-pass").placeholder = m ? "Leave empty to keep" : "Type here";
  $("f-pass").required = !m;       // required only for new members
  setMsg("");
}

function renderSaved() {
  const box = $("saved-list");
  box.replaceChildren();
  const filled = members.map((m, i) => ({ m, i })).filter((x) => x.m);
  if (!filled.length) {
    box.append(el("p", { class: "empty", text: "No members registered yet" }));
    return;
  }
  filled.forEach(({ m, i }) => {
    const card = el("div", { class: `member-card${i === selected ? " active" : ""}` }, [
      el("div", { class: "avatar", text: (m.name || "?")[0].toUpperCase() }),
      el("div", { class: "info" }, [
        el("strong", { text: m.name }),
        el("small", { text: "ID: " + m.id }),
        el("small", { text: "Role: " + m.role }),
      ]),
    ]);
    card.addEventListener("click", () => selectSlot(i));
    box.append(card);
  });
}

function setMsg(text, type = "") {
  const p = $("form-msg");
  p.textContent = text;
  p.className = "form-msg" + (type ? " " + type : "");
}

function renderAll() { renderSlots(); renderForm(); renderSaved(); }

function selectSlot(i) { selected = i; renderAll(); }

// ================= SAVE =================
$("member-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("f-name").value.trim();
  const id = $("f-id").value.trim();
  const role = $("f-role").value;
  const password = $("f-pass").value;

  if (!name || !id || !role) return setMsg("Fill in name, ID and role.", "error");
  if (!members[selected] && password.length < 8) return setMsg("Password must have at least 8 characters.", "error");
  if (members.some((m, i) => m && i !== selected && m.id === id)) return setMsg("That ID is already registered.", "error");

  try {
    const saved = await saveMember(selected, { name, id, role, password });
    members[selected] = { id: saved.id, name: saved.name, role: saved.role };
    $("f-pass").value = "";                      // clear the password from the field
    renderSlots(); renderSaved();
    setMsg("Saved.", "ok");
  } catch (err) {
    console.error("Could not save member:", err);
    setMsg("Could not save. Try again.", "error");
  }
});

renderAll();
// Only admins register crew members (auth_guard.js); also shows the page
requireRole(["admin"]);
connectLogoutButton();  // from supabase_client.js (no-op without #logout-btn)
