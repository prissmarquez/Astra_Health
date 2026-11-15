

const $ = (id) => document.getElementById(id);


// Creates an element with an optional class and text (text is safe)
function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

// Shows a simple message (e.g. "No records") inside a box
function showEmpty(box, text) {
  box.replaceChildren(makeEl("p", "empty", text));
}

// Only these values are allowed as CSS classes (anything else is ignored)
const ALLOWED_SOURCES = ["sensor", "manual"];
const ALLOWED_STATUS = ["normal", "follow", "attention", "none"];

function safeClass(value, allowed) {
  return allowed.includes(value) ? value : "";
}

// Creates an SVG element and sets its attributes
const SVG_NS = "http://www.w3.org/2000/svg";

function makeSvg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const name in attrs) {
    el.setAttribute(name, attrs[name]);
  }
  return el;
}

//  DATA SOURCE 

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

// INDICATORS
const INDICATORS = {
  hr: { label: "Heart rate", unit: "BPM", column: "heart_rate", range: { min: 50, max: 100 } },
  spo2: { label: "SpO₂", unit: "%", column: "spo2", range: { min: 95, max: 100 } },
  bp: { label: "Blood pressure (systolic)", unit: "mmHg", column: "systolic_pressure", range: { min: 90, max: 129 } },
  glucose: { label: "Glucose", unit: "mg/dL", column: "glucose", range: { min: 55, max: 180 } },
  temp: { label: "Body temperature", unit: "°C", column: "temperature", range: { min: 35, max: 38 } },
};

// STATE 
let crew = [];
let selectedId = null;
let indicator = "hr";
let days = 7;
let history = null;
let requestId = 0;

// RENDER 
function showCrew() {
  const box = $("crew-list");
  if (!crew.length) {
    showEmpty(box, "No crew members");
    return;
  }

  box.replaceChildren(); // clear the list

  crew.forEach((m) => {
    const item = makeEl("div", "team-item" + (m.id === selectedId ? " active" : ""));
    item.dataset.id = m.id;   // uuid: keep as text

    const name = m.name || "?";
    item.appendChild(makeEl("div", "avatar", name[0]));

    const info = makeEl("div", "info");
    info.appendChild(makeEl("strong", "", name));
    info.appendChild(makeEl("div", "role", m.role));
    item.appendChild(info);

    const value = makeEl("div", "value");
    value.appendChild(makeEl("i", "dot " + safeClass(m.status, ALLOWED_STATUS)));
    item.appendChild(value);

    item.addEventListener("click", () => selectMember(m.id));
    box.appendChild(item);
  });
}

function showChart(chart) {
  const box = $("chart");
  if (!chart || !chart.points || !chart.points.length) {
    showEmpty(box, "No data for this period");
    return;
  }
  const W = 600, H = 230, L = 40, R = 15, T = 15, B = 30;
  const vals = chart.points.map((p) => Number(p.value));
  const lo = Math.min(...vals, chart.range ? chart.range.min : Infinity);
  const hi = Math.max(...vals, chart.range ? chart.range.max : -Infinity);
  const pad = (hi - lo) * 0.1 || 1;
  const min = lo - pad, max = hi + pad;
  const x = (i) => L + (i * (W - L - R)) / Math.max(chart.points.length - 1, 1);
  const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);

  const svg = makeSvg("svg", { viewBox: `0 0 ${W} ${H}` });

  // Horizontal grid lines + value labels
  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    svg.appendChild(makeSvg("line", { class: "axis", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    const label = makeSvg("text", { class: "label", x: L - 6, y: y(v) + 4, "text-anchor": "end" });
    label.textContent = Math.round(v * 10) / 10;
    svg.appendChild(label);
  }

  // Green zone band
  if (chart.range) {
    svg.appendChild(makeSvg("rect", {
      class: "range-band",
      x: L,
      y: y(chart.range.max),
      width: W - L - R,
      height: y(chart.range.min) - y(chart.range.max)
    }));
  }

  // Line
  const path = vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  svg.appendChild(makeSvg("path", { class: "series", d: path }));

  // Points + day labels (text from the database -> textContent)
  chart.points.forEach((p, i) => {
    const circle = makeSvg("circle", { class: "data-point", cx: x(i), cy: y(vals[i]), r: 4.5 });
    const tooltip = makeSvg("title", {});
    tooltip.textContent = `${p.label} - ${p.value} ${chart.unit || ""}`;
    circle.appendChild(tooltip);
    svg.appendChild(circle);

    const dayLabel = makeSvg("text", { class: "label", x: x(i), y: H - 8, "text-anchor": "middle" });
    dayLabel.textContent = p.label;
    svg.appendChild(dayLabel);
  });

  box.replaceChildren(svg);
}

function showRecords(rows) {
  const body = $("records-body");
  if (!rows || !rows.length) {
    const tr = makeEl("tr");
    const td = makeEl("td", "empty", "No records");
    td.colSpan = 5;
    tr.appendChild(td);
    body.replaceChildren(tr);
    return;
  }

  body.replaceChildren(); // clear the table

  rows.forEach((r) => {
    const tr = makeEl("tr");
    tr.appendChild(makeEl("td", "", r.datetime));
    tr.appendChild(makeEl("td", "", r.indicator));
    tr.appendChild(makeEl("td", "", r.value));

    // Source tag: colored dot + "Manual" or "Sensor"
    const sourceTd = makeEl("td");
    const tag = makeEl("span", "source-tag");
    tag.appendChild(makeEl("i", "dot " + safeClass(r.source, ALLOWED_SOURCES)));
    tag.append(" " + (r.source === "manual" ? "Manual" : "Sensor"));
    sourceTd.appendChild(tag);
    tr.appendChild(sourceTd);

    tr.appendChild(makeEl("td", "", r.notes || ""));
    body.appendChild(tr);
  });
}

function showHistory() {
  $("chart-title").textContent = INDICATORS[indicator].label;
  if (!history) return;
  showChart(history.series[indicator]);
  showRecords(history.records);
}


async function loadHistory() {
  if (selectedId == null) return;
  const current = ++requestId;
  showEmpty($("chart"), "Loading...");
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

// START 
(async function init() {
  const profile = await requireRole(["admin"]);  // auth_guard.js: others -> principal_page.html
  if (!profile) return;
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