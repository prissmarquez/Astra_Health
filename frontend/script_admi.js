// =====================================================
//  ADMIN HISTORY (read-only)
//  Data comes from Supabase with the admin's session (admin RLS sees everyone).
//  Uses supabaseClient and getProfile from supabase_client.js.
// =====================================================

const $ = (id) => document.getElementById(id);

// Escapes text from the database before it goes into innerHTML (avoids XSS)
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// ================= DATA SOURCE (Supabase) =================

// traffic light (health_analyses) -> status used by this page
const STATUS_FROM_LIGHT = { green: "normal", yellow: "follow", red: "attention" };

/** getCrew() -> [{ id, name, role, status: "normal"|"follow"|"attention"|"none", photo }] */
async function getCrew() {
  const { data: people, error } = await supabaseClient
    .from("profiles")
    .select("id, name, astronaut_code, role, crew_id")
    .neq("role", "admin")
    .order("crew_id")
    .order("astronaut_code");
  if (error) throw new Error(error.message);

  const { data: analyses } = await supabaseClient
    .from("health_analyses")
    .select("astronaut_id, traffic_light, analyzed_at")
    .order("analyzed_at", { ascending: false });
  const latest = {};
  for (const a of analyses || []) {
    if (!latest[a.astronaut_id]) latest[a.astronaut_id] = a.traffic_light;
  }

  return people.map((p) => ({
    id: p.id,  // uuid (text), not a number
    name: p.name || p.astronaut_code,
    role: `${p.astronaut_code || ""} · ${p.role} · ${p.crew_id || "no crew"}`,
    status: STATUS_FROM_LIGHT[latest[p.id]] || "none",
    photo: null,
  }));
}

/**
 * getMemberHistory(id, days) -> {
 *   series: { hr|spo2|bp|glucose|temp: { unit, range: {min, max}, points: [{ label, value }] } },
 *   records: [{ datetime, indicator, value, source: "sensor"|"manual", notes }]
 * }
 */
async function getMemberHistory(id, days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // One row per day -> chart points
  const { data: daily, error } = await supabaseClient
    .from("daily_readings")
    .select("day, heart_rate, spo2, systolic_pressure, glucose, temperature")
    .eq("astronaut_id", id)
    .gte("day", since.slice(0, 10))
    .order("day", { ascending: true });
  if (error) throw new Error(error.message);

  const series = {};
  for (const [key, cfg] of Object.entries(INDICATORS)) {
    series[key] = {
      unit: cfg.unit,
      range: cfg.range,
      points: daily
        .filter((d) => d[cfg.column] != null)
        .map((d) => ({ label: d.day.slice(5), value: Math.round(d[cfg.column] * 10) / 10 })),
    };
  }

  // Every single measurement -> table
  const { data: rows, error: err2 } = await supabaseClient
    .from("readings_detailed")
    .select("taken_date, taken_time, indicator_name, value, unit, source, sensor_name")
    .eq("astronaut_id", id)
    .gte("taken_at", since)
    .order("taken_at", { ascending: false })
    .limit(100);
  if (err2) throw new Error(err2.message);

  const records = rows.map((r) => ({
    datetime: `${r.taken_date} · ${r.taken_time}`,
    indicator: r.indicator_name,
    value: `${r.value} ${r.unit}`,
    source: ["manual", "questionnaire"].includes(r.source) ? "manual" : "sensor",
    notes: r.sensor_name,
  }));

  return { series, records };
}

// ================= INDICATORS =================
// range = GREEN zone of the health engine (backend/ml/health_engine.py):
//   HR 50-100 bpm at rest (AHA) · SpO2 >= 95 % (BTS) · systolic 90-129 mmHg
//   (ACC/AHA 2017, ESC/ESH 2018) · glucose 55-180 mg/dL (Endocrine Society / ADA)
//   temperature < 38 °C = 37 °C + 1.0 (Stahn 2017); 35 °C = hypothermia threshold
const INDICATORS = {
  hr: { label: "Heart rate", unit: "BPM", column: "heart_rate", range: { min: 50, max: 100 } },
  spo2: { label: "SpO₂", unit: "%", column: "spo2", range: { min: 95, max: 100 } },
  bp: { label: "Blood pressure (systolic)", unit: "mmHg", column: "systolic_pressure", range: { min: 90, max: 129 } },
  glucose: { label: "Glucose", unit: "mg/dL", column: "glucose", range: { min: 55, max: 180 } },
  temp: { label: "Body temperature", unit: "°C", column: "temperature", range: { min: 35, max: 38 } },
};

// ================= STATE =================
let crew = [];
let selectedId = null;
let indicator = "hr";
let days = 7;
let history = null;
let requestId = 0;

// ================= RENDER =================
function showCrew() {
  const box = $("crew-list");
  if (!crew.length) { box.innerHTML = '<p class="empty">No crew members</p>'; return; }
  box.innerHTML = crew.map((m) => `
    <div class="team-item ${m.id === selectedId ? "active" : ""}" data-id="${esc(m.id)}">
      <div class="avatar">${esc(m.name[0])}</div>
      <div class="info"><strong>${esc(m.name)}</strong><div class="role">${esc(m.role)}</div></div>
      <div class="value"><i class="dot ${m.status}"></i></div>
    </div>`).join("");
  box.querySelectorAll(".team-item").forEach((el) =>
    el.addEventListener("click", () => selectMember(el.dataset.id)));  // uuid: keep as text
}

function showChart(chart) {
  const box = $("chart");
  if (!chart || !chart.points || !chart.points.length) {
    box.innerHTML = '<p class="empty">No data for this period</p>';
    return;
  }
  const W = 600, H = 230, L = 40, R = 15, T = 15, B = 30;
  const vals = chart.points.map((p) => p.value);
  const lo = Math.min(...vals, chart.range ? chart.range.min : Infinity);
  const hi = Math.max(...vals, chart.range ? chart.range.max : -Infinity);
  const pad = (hi - lo) * 0.1 || 1;
  const min = lo - pad, max = hi + pad;
  const x = (i) => L + (i * (W - L - R)) / Math.max(chart.points.length - 1, 1);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    svg += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
            <text class="label" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${Math.round(v * 10) / 10}</text>`;
  }
  if (chart.range) {
    svg += `<rect class="range-band" x="${L}" y="${y(chart.range.max)}" width="${W - L - R}" height="${y(chart.range.min) - y(chart.range.max)}"/>`;
  }
  const path = chart.points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.value)}`).join(" ");
  svg += `<path class="series" d="${path}"/>`;
  chart.points.forEach((p, i) => {
    svg += `<circle class="data-point" cx="${x(i)}" cy="${y(p.value)}" r="4.5"><title>${esc(p.label)} - ${p.value} ${esc(chart.unit)}</title></circle>
            <text class="label" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p.label)}</text>`;
  });
  svg += "</svg>";
  box.innerHTML = svg;
}

function showRecords(rows) {
  const body = $("records-body");
  if (!rows || !rows.length) {
    body.innerHTML = '<tr><td colspan="5" class="empty">No records</td></tr>';
    return;
  }
  body.innerHTML = rows.map((r) => `
    <tr>
      <td>${esc(r.datetime)}</td>
      <td>${esc(r.indicator)}</td>
      <td>${esc(r.value)}</td>
      <td><span class="source-tag"><i class="dot ${r.source}"></i> ${r.source === "manual" ? "Manual" : "Sensor"}</span></td>
      <td>${esc(r.notes)}</td>
    </tr>`).join("");
}

function showHistory() {
  $("chart-title").textContent = INDICATORS[indicator].label;
  if (!history) return;
  showChart(history.series[indicator]);
  showRecords(history.records);
}

// ================= ACTIONS =================
async function loadHistory() {
  if (selectedId == null) return;
  const current = ++requestId;
  $("chart").innerHTML = '<p class="empty">Loading...</p>';
  try {
    const data = await getMemberHistory(selectedId, days);
    if (current !== requestId) return;
    history = data;
    showHistory();
  } catch (err) {
    console.error("Could not load history:", err);
    if (current !== requestId) return;
    history = null;
    showChart(null);
    showRecords(null);
  }
}

function selectMember(id) {
  selectedId = id;
  const m = crew.find((c) => c.id === id);
  $("member-title").textContent = m ? m.name + " – Health history" : "Health history";
  showCrew();
  loadHistory();
  history_replaceUrl(id);  // refresh / share keeps the same person
}

function history_replaceUrl(id) {
  const url = new URL(location.href);
  url.searchParams.set("id", id);
  window.history.replaceState({}, "", url);
}

// indicator buttons: only change the chart (no new request)
$("indicator-chips").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  indicator = btn.dataset.indicator;
  document.querySelectorAll("#indicator-chips .chip").forEach((c) => c.classList.toggle("active", c === btn));
  showHistory();
});

// period buttons: ask for the data again
$("period-chips").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  days = Number(btn.dataset.days);
  document.querySelectorAll("#period-chips .chip").forEach((c) => c.classList.toggle("active", c === btn));
  loadHistory();
});

// ================= START =================
(async function init() {
  const profile = await getProfile();
  if (!profile || profile.role !== "admin") {
    window.location.href = "index.html";  // only admins can be here
    return;
  }
  try {
    crew = await getCrew();
  } catch (err) {
    console.error("Could not load crew:", err);
    crew = [];
  }
  showCrew();
  const idFromUrl = new URLSearchParams(location.search).get("id");  // uuid text
  const valid = crew.some((c) => c.id === idFromUrl);
  if (crew.length) selectMember(valid ? idFromUrl : crew[0].id);
})();
