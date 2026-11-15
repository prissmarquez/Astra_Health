// =====================================================
//  BODY AI PAGE (crew member view)
//  Teammate: only edit getAnalysis() and generateImage().
// =====================================================

const $ = (id) => document.getElementById(id);

// ================= DATA SOURCE (TEAMMATE EDITS HERE) =================
// API_URL comes from supabase_client.js (our FastAPI server).
const BODY_API_URL = API_URL + "/body";   // GET /body/{system} in backend/main.py
const USE_SAMPLE_DATA = false;   // true = example data, without the backend
const USE_SAMPLE_IMAGE = true;   // the image endpoint does not exist yet

/**
 * getAnalysis(system) -> Promise of:
 * {
 *   updatedAgo: "2 min ago",
 *   summary:    "General AI text shown in the AI analysis box",
 *   status:     "stable" | "watch" | "attention",
 *   metric:     { label, value, unit, trend, points: [numbers] },   // trend e.g. "+8% vs. average"
 *   explanation:"Detail of the selected system",
 *   recommendations: ["...", "..."]
 * }
 * system: "cardio" | "resp" | "digest" | "muscle" | "nerv" | "immune" | "thermo"
 * Every text is rendered with textContent, so the AI text is never run as HTML.
 */
async function getAnalysis(system) {
  if (USE_SAMPLE_DATA) return sampleAnalysis(system);
  const token = await getAccessToken();             // supabase_client.js
  if (!token) throw new Error("Session expired, please log in again.");
  const res = await fetch(`${BODY_API_URL}/${encodeURIComponent(system)}`, {
    headers: { Authorization: "Bearer " + token },
  });
  if (!res.ok) throw new Error("Status " + res.status);
  return res.json();
}

/**
 * generateImage(prompt) -> Promise of { url } (or { dataUrl })
 * Keep the image API key on the BACKEND, never in this file.
 */
async function generateImage(prompt) {
  if (USE_SAMPLE_IMAGE) {
    await new Promise((r) => setTimeout(r, 800));       // simulates waiting
    return { url: "assets/body.png" };                   // example image
  }
  const res = await fetch(`${BODY_API_URL}/image`, {
  const res = await fetch(`${BODY_API_URL}/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error("Status " + res.status);
  return res.json();
}

// ================= SYSTEMS =================
const SYSTEMS = {
  cardio: "Cardiovascular system",
  resp:   "Respiratory system",
  digest: "Digestive system",
  muscle: "Muscular system",
  nerv:   "Nervous system",
  immune: "Immune system",
  thermo: "Thermoregulation",
};

// ================= SAMPLE DATA (delete when the AI works) =================
function sampleAnalysis(system) {
  return {
    updatedAgo: "2 min ago",
    summary: `Example analysis for the ${SYSTEMS[system].toLowerCase()}.\nThe real text will come from the AI.`,
    status: system === "cardio" ? "watch" : "stable",
    metric: { label: "Latest reading", value: 72, unit: "bpm", trend: "+8% vs. average", points: [66, 68, 67, 70, 69, 72] },
    explanation: "Example explanation: a slight change was detected compared with your usual values.",
    recommendations: ["Do breathing exercises (3–5 min).", "Stay hydrated.", "Complete your next check-in."],
  };
}

// ================= SAFE HELPERS =================
const STATUS = {
  stable:    "Stable",
  watch:     "Under observation",
  attention: "Needs attention",
};
const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function drawSpark(points) {
  const box = $("spark");
  box.replaceChildren();
  const nums = (points || []).map(Number).filter((n) => !isNaN(n));
  if (nums.length < 2) return;
  const W = 200, H = 60, P = 6;
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  const x = (i) => P + (i * (W - 2 * P)) / (nums.length - 1);
  const y = (v) => H - P - ((v - min) / span) * (H - 2 * P);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "none" });
  svg.append(svgEl("path", { class: "line", d: nums.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ") }));
  svg.append(svgEl("circle", { class: "dot", cx: x(nums.length - 1), cy: y(nums[nums.length - 1]), r: 3.5 }));
  box.append(svg);
}

// ================= RENDER =================
function showAnalysis(system, d) {
  $("ai-updated").textContent = d.updatedAgo ? "Updated: " + d.updatedAgo : "--";
  $("ai-summary").className = "ai-text";
  $("ai-summary").textContent = d.summary ?? "";

  $("system-title").textContent = SYSTEMS[system];
  const status = Object.hasOwn(STATUS, d.status) ? d.status : "stable";   // whitelist
  const pill = $("system-status");
  pill.textContent = STATUS[status];
  pill.className = "status-pill " + status;

  const m = d.metric || {};
  $("metric-value").textContent = m.value ?? "--";
  $("metric-unit").textContent = m.unit ?? "";
  $("metric-trend").textContent = m.trend ?? "";
  $("metric-label").textContent = m.label ?? "";
  drawSpark(m.points);

  $("system-explanation").textContent = d.explanation ?? "";

  const list = $("reco-list");
  list.replaceChildren();
  (d.recommendations || []).forEach((r) => {
    const li = document.createElement("li");
    li.textContent = r;
    list.append(li);
  });
}

function showState(text, cls) {
  const p = $("ai-summary");
  p.className = "ai-text " + cls;
  p.textContent = text;
}

// ================= SELECT A SYSTEM =================
let requestId = 0;

async function selectSystem(system) {
  document.querySelectorAll(".system-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.system === system));

  const current = ++requestId;
  showState("Analyzing...", "loading");
  try {
    const data = await getAnalysis(system);
    if (current !== requestId) return;          // a newer click already started
    showAnalysis(system, data);
  } catch (err) {
    console.error("Could not load analysis:", err);
    if (current !== requestId) return;
    showState("Could not load the analysis. Try again.", "error");
  }
}

$("systems-list").addEventListener("click", (e) => {
  const btn = e.target.closest(".system-btn");
  if (btn && Object.hasOwn(SYSTEMS, btn.dataset.system)) selectSystem(btn.dataset.system);
});

// ================= AI IMAGE =================
// only allow http(s), relative paths and data:image (blocks javascript: etc.)
function safeImageSrc(src) {
  if (typeof src !== "string") return "";
  if (/^data:image\/(png|jpeg|webp|gif);base64,/i.test(src)) return src;
  try {
    const u = new URL(src, location.href);
    return ["http:", "https:", "file:"].includes(u.protocol) ? src : "";
  } catch { return ""; }
}

function setImageMsg(text, type = "") {
  const p = $("image-msg");
  p.textContent = text;
  p.className = "form-msg" + (type ? " " + type : "");
}

$("image-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const prompt = $("image-prompt").value.trim();
  if (!prompt) return setImageMsg("Write what you want to generate.", "error");

  const btn = $("image-btn");
  btn.disabled = true;
  setImageMsg("Generating...");
  try {
    const data = await generateImage(prompt);
    const src = safeImageSrc(data.url || data.dataUrl);
    if (!src) throw new Error("Invalid image");
    const img = document.createElement("img");
    img.alt = prompt;
    img.src = src;
    img.addEventListener("error", () => setImageMsg("The image could not be loaded.", "error"));
    $("image-box").replaceChildren(img);
    setImageMsg("Done.", "ok");
  } catch (err) {
    console.error("Could not generate image:", err);
    setImageMsg("Could not generate the image. Try again.", "error");
  } finally {
    btn.disabled = false;
  }
});

selectSystem("cardio");
// Only crew members and leaders (auth_guard.js); also shows the page
requireRole(["crew", "leader"]);
connectLogoutButton();  // from supabase_client.js (no-op without #logout-btn)
