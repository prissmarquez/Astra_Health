

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
    return;
  }


  const light = LIGHT[a.traffic_light];
  setText("salud-pct", a.traffic_light.toUpperCase());
  setText("salud-texto", light.text);
  ring.style.background = `conic-gradient(${light.color} 100%, #1a2a50 0)`;

  // Indicators needing attention
  const reasons = [...a.clinical_reasons, ...a.deviations.map((d) => `vs your normal: ${d}`)];
  if (a.detected_by_ml) reasons.push("unusual pattern (ML)");
  if (reasons.length === 0) {
    setText("atencion-titulo", "No indicators needing attention");
    setText("atencion-detalle", `Last check-in: ${formatLocalDateTime(a.analyzed_at)}`);
  } else {
    setText("atencion-titulo", reasons[0]);
    setText("atencion-detalle", [...reasons.slice(1), ...a.connections].join(" · "));
  }
}



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
