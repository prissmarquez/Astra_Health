

const LIGHT = {
  green: { color: "var(--green)", text: "No alerts" },
  yellow: { color: "var(--yellow)", text: "Watch" },
  red: { color: "var(--red)", text: "Needs attention" },
};


const CHART_INDICATORS = [
  { id: "ind-hr", label: "HR", max: 140, min_ok: 50, max_ok: 100 },
  { id: "ind-spo2", label: "SpO₂", max: 100, min_ok: 95, max_ok: 100 },
  { id: "ind-glu", label: "Glucose", max: 250, min_ok: 55, max_ok: 180 },
  { id: "ind-bp", label: "BP", max: 180, min_ok: 90, max_ok: 129 },
];

// Names used by the health engine -> words for the crew + History indicator (if it has one)
const ENGINE_NAMES = {
  "HR": ["Heart rate", "hr"],
  "HRV": ["Heart rate variability", "hrv"],
  "sleep": ["Sleep", "sleep"],
  "positive mood": ["Positive mood", "mood_pos"],
  "negative mood": ["Negative mood", "mood_neg"],
  "glucose": ["Glucose", "glucose"],
  "systolic pressure": ["Systolic pressure", "bp"],
  "diastolic pressure": ["Diastolic pressure", "bp"],
  "temperature": ["Temperature", "temp"],
  "SpO2": ["SpO₂", "spo2"],
};

// Critical clinical reason -> History indicator
const REASON_INDICATOR = {
  "low SpO2": "spo2",
  "high temperature": "temp",
  "very high temperature during exercise": "temp",
  "HR out of range": "hr",
  "high pressure": "bp",
  "low pressure": "bp",
  "glucose out of range": "glucose",
  "severe habitual sleep deficit": "sleep",
};

const ADVISORY = "advisory: ";  // clinical reasons that are only a warning

function historyUrl(indicator) {
  return indicator ? `historical.html?indicator=${encodeURIComponent(indicator)}` : "historical.html";
}

// "HR ↑ (+2.6σ)" -> { text: "Heart rate higher than your usual", indicator: "hr" }
function describeDeviation(d) {
  const m = /^(.+) ([↑↓]) \(([+-]?\d+(?:\.\d+)?)σ\)$/.exec(d);
  if (!m) return { text: d, indicator: null };
  const [label, indicator] = ENGINE_NAMES[m[1]] || [m[1], null];
  return { text: `${label} ${m[2] === "↑" ? "higher" : "lower"} than your usual`, indicator };
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}



function fillHeader(profile) {
  setText("nombre-usuario", profile.name || profile.astronaut_code);
  setText("rol-usuario", `${profile.astronaut_code || ""} · ${profile.role}`);
}



async function fillLatestValues(profile) {
  const { data, error } = await supabaseClient
    .from("daily_readings")
    .select("day, heart_rate, spo2, glucose, systolic_pressure, diastolic_pressure")
    .eq("astronaut_id", profile.id)
    .order("day", { ascending: false })
    .limit(1);
  if (error) return console.error("daily_readings:", error.message);

  const r = data[0];
  if (!r) {
    for (const id of ["ind-hr", "ind-spo2", "ind-glu", "ind-bp"]) setText(id, "--");
    return;
  }
  setText("ind-hr", r.heart_rate != null ? `${Math.round(r.heart_rate)} bpm` : "--");
  setText("ind-spo2", r.spo2 != null ? `${r.spo2}%` : "--");
  setText("ind-glu", r.glucose != null ? `${Math.round(r.glucose)} mg/dL` : "--");
  setText("ind-bp", r.systolic_pressure != null
    ? `${Math.round(r.systolic_pressure)}/${Math.round(r.diastolic_pressure)} mmHg` : "--");
}



async function fillHealthStatus(profile) {
  const { data, error } = await supabaseClient
    .from("health_analyses")
    .select("traffic_light, clinical_reasons, deviations, connections, detected_by_ml, day, analyzed_at")
    .eq("astronaut_id", profile.id)
    .order("analyzed_at", { ascending: false })
    .limit(1);
  if (error) return console.error("health_analyses:", error.message);

  const ring = document.getElementById("anillo");
  const a = data[0];
  if (!a) {
    setText("salud-pct", "--");
    setText("salud-texto", "No check-in yet");
    ring.style.background = "conic-gradient(#1a2a50 100%, #1a2a50 0)";
    showWarnings([]);
    return;
  }


  const light = LIGHT[a.traffic_light];
  setText("salud-pct", a.traffic_light.toUpperCase());
  setText("salud-texto", light.text);
  ring.style.background = `conic-gradient(${light.color} 100%, #1a2a50 0)`;

  const reasons = a.clinical_reasons || [];

  // Indicators needing attention: critical clinical limits only
  const critical = reasons.filter((r) => !r.startsWith(ADVISORY));
  if (critical.length === 0) {
    setText("atencion-titulo", "No indicators needing attention");
    setText("atencion-detalle", `Last check-in: ${formatLocalDateTime(a.analyzed_at)}`);
  } else {
    setText("atencion-titulo", critical[0]);
    setText("atencion-detalle", [...critical.slice(1), ...(a.connections || [])].join(" · "));
  }
  attentionIndicator = REASON_INDICATOR[critical[0]] || null;

  // Warnings: not critical (advisories, changes vs the usual, ML pattern)
  const warnings = [
    ...reasons.filter((r) => r.startsWith(ADVISORY))
      .map((r) => ({ text: r.slice(ADVISORY.length), indicator: r.includes("sleep") ? "sleep" : null })),
    ...(a.deviations || []).map(describeDeviation),
  ];
  if (a.detected_by_ml) {
    warnings.push({ text: "Unusual pattern compared with your history (ML)", indicator: null });
  }
  showWarnings(warnings);
}

let attentionIndicator = null;  // History indicator for "View details"
let warningIndicator = null;    // History indicator for "View in History"

function showWarnings(warnings) {
  const list = document.getElementById("lista-avisos");
  list.replaceChildren();
  if (warnings.length === 0) {
    const li = document.createElement("li");
    li.className = "sin-avisos";
    li.textContent = "No warnings: your values look like your usual.";
    list.append(li);
  }
  for (const w of warnings) {
    const li = document.createElement("li");
    li.textContent = w.text;
    list.append(li);
  }
  warningIndicator = (warnings.find((w) => w.indicator) || {}).indicator || null;
}

document.getElementById("atencion-btn").addEventListener("click", () => {
  location.href = historyUrl(attentionIndicator);
});
document.getElementById("avisos-btn").addEventListener("click", () => {
  location.href = historyUrl(warningIndicator);
});



async function fillTeam(profile) {
  const box = document.getElementById("equipo-lista");
  box.textContent = "";
  if (profile.role !== "admin" && !profile.crew_id) {
    box.textContent = "You are not in a crew yet.";
    return;
  }

  let people = supabaseClient.from("profiles").select("id, name, astronaut_code, role");
  people = profile.role === "admin"
    ? people.neq("role", "admin")
    : people.eq("crew_id", profile.crew_id).neq("id", profile.id);
  const { data: members, error } = await people.order("astronaut_code");
  if (error) return console.error("profiles:", error.message);

  // Latest traffic light per person (RLS returns only what this role may see)
  const latest = {};
  if (profile.role !== "crew") {
    const { data: analyses } = await supabaseClient
      .from("health_analyses")
      .select("astronaut_id, traffic_light, analyzed_at")
      .in("astronaut_id", members.map((m) => m.id))
      .order("analyzed_at", { ascending: false });
    for (const a of analyses || []) {
      if (!latest[a.astronaut_id]) latest[a.astronaut_id] = a.traffic_light;
    }
  }

  if (members.length === 0) {
    box.textContent = "No crewmates yet.";
    return;
  }
  for (const m of members) {
    const row = document.createElement("div");
    const dot = document.createElement("span");
    const name = document.createElement("span");
    const status = document.createElement("small");

    const light = latest[m.id];
    dot.textContent = "● ";
    dot.style.color = light ? LIGHT[light].color : "#7a86a8";
    name.textContent = `${m.astronaut_code || ""} ${m.name}`;
    status.textContent = profile.role === "crew"
      ? "  (only the leader sees their status)"
      : `  ${light ? LIGHT[light].text : "no check-in yet"}`;

    row.append(dot, name, status);
    box.appendChild(row);
  }
}



function renderIndicatorsChart() {
  const box = document.getElementById("barras");
  if (!box) return;
  box.innerHTML = CHART_INDICATORS.map((c) => {
    const el = document.getElementById(c.id);
    const value = el ? parseFloat(el.textContent) : NaN;
    if (isNaN(value)) {
      return `<div class="barra-g"><span class="v">--</span><div class="col"></div><span class="l">${c.label}</span></div>`;
    }
    const pct = Math.min(100, (value / c.max) * 100);
    const ok = value >= c.min_ok && value <= c.max_ok;
    return `
      <div class="barra-g">
        <span class="v">${value}</span>
        <div class="col"><div class="fill ${ok ? "ok" : "warn"}" style="height:${pct}%"></div></div>
        <span class="l">${c.label}</span>
      </div>`;
  }).join("");
}


connectLogoutButton();  // from supabase_client.js

(async function () {
  const profile = await requireRole(["crew", "leader", "admin"]);  // auth_guard.js
  if (!profile) return;  // already redirecting
  fillHeader(profile);
  await Promise.all([fillLatestValues(profile), fillHealthStatus(profile), fillTeam(profile)]);
  renderIndicatorsChart();  // after the values are in place
})();
