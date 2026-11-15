// =====================================================
//  HISTORY PAGE
//  Teammates: only edit the section "DATA SOURCE" below.
// =====================================================

const $ = (id) => document.getElementById(id);

// ================= DATA SOURCE (TEAMMATES EDIT HERE) =================
const API_URL = null;            // e.g. "http://localhost:3000/api/history"
const USE_SAMPLE_DATA = true;    // set to false when the real API works

/**
 * Must return a Promise that resolves to:
 * {
 *   user:    { name, role, photo },
 *   source:  "Biometric sensor ...",
 *   chart:   { unit, range: {min, max}, points: [{ label, value }] },
 *   records: [{ datetime, indicator, value, source: "sensor"|"manual", notes }],
 *   team:    [{ name, value, unit, status: "normal"|"follow"|"attention", photo }]
 * }
 * indicator: "hr" | "spo2" | "bp" | "glucose" | "temp"
 * days: 7 | 14 | 30
 */
async function getHistoryData(indicator, days) {
  if (USE_SAMPLE_DATA || !API_URL) return buildSampleData(indicator, days);

  const res = await fetch(`${API_URL}?indicator=${indicator}&days=${days}`);
  if (!res.ok) throw new Error("Status " + res.status);
  return res.json();
}

// ================= INDICATORS (icon changes with the selection) =================
const INDICATORS = {
  hr:      { label: "Heart rate",       unit: "BPM",   range: { min: 60, max: 100 },  base: 72,   spread: 10,  icon: "assets/recourse2.png" },
  spo2:    { label: "SpO₂",             unit: "%",     range: { min: 95, max: 100 },  base: 98,   spread: 2,   icon: "assets/oxigen.png" },
  bp:      { label: "Blood pressure",   unit: "mmHg",  range: { min: 90, max: 120 },  base: 118,  spread: 8,   icon: "assets/BP.jpg" },
  glucose: { label: "Glucose",          unit: "mg/dL", range: { min: 70, max: 100 },  base: 92,   spread: 8,   icon: "assets/gluco.png" },
  temp:    { label: "Body temperature", unit: "°C",    range: { min: 36, max: 37.5 }, base: 36.8, spread: 0.6, icon: null },
};

// ================= SAMPLE DATA (delete when the API works) =================
function buildSampleData(indicator, days) {
  const cfg = INDICATORS[indicator];
  const today = 84;
  const n = Math.min(Number(days), 10);
  const points = [];
  for (let i = n - 1; i >= 0; i--) {
    const wave = Math.sin((today - i) * 1.7) * cfg.spread;
    points.push({ label: "Day " + (today - i), value: Math.round((cfg.base + wave) * 10) / 10 });
  }
  const fmt = (v) => (indicator === "bp" ? `${Math.round(v)}/76` : v) + " " + cfg.unit;
  const records = points.slice().reverse().slice(0, 4).map((p, i) => ({
    datetime: `${p.label} · ${["09:15", "21:30", "08:45", "20:10"][i]}`,
    indicator: cfg.label,
    value: fmt(p.value),
    source: i === 2 ? "manual" : "sensor",
    notes: i === 1 ? "After exercise." : i === 2 ? "Slight fatigue." : "No notes.",
  }));
  const names = ["Elena Torres", "Marco Silva", "Mei Chen", "Daniel Kim"];
  const status = ["normal", "normal", "follow", "normal"];
  const team = names.map((name, i) => ({
    name,
    value: Math.round((cfg.base + (i - 1) * cfg.spread * 0.4) * 10) / 10,
    unit: cfg.unit,
    status: status[i],
    photo: null,
  }));
  return {
    user: { name: "Elena Torres", role: "Cmdr. – Mission Day 84", photo: "assets/profile.png" },
    source: "Biometric sensor integrated in the ship",
    chart: { unit: cfg.unit, range: cfg.range, points },
    records,
    team,
  };
}

// ================= RENDER FUNCTIONS =================
// SECURITY: data from the database is ALWAYS shown with textContent
// or setAttribute, never with innerHTML. This way, if a note contains
// HTML or <script>, it is shown as plain text and never runs.

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
const ALLOWED_STATUS = ["normal", "follow", "attention"];

function safeClass(value, allowed) {
  return allowed.includes(value) ? value : "";
}

function showUser(u) {
  if (!u) return;
  $("user-name").textContent = u.name;
  $("user-role").textContent = u.role;
  if (u.photo) document.querySelector(".foto-perfil").src = u.photo;
}

// ----- Chart (SVG) -----
const SVG_NS = "http://www.w3.org/2000/svg";

// Creates an SVG element and sets its attributes
function makeSvg(tag, attrs) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const name in attrs) {
    el.setAttribute(name, attrs[name]);
  }
  return el;
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

  // Normal range band
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

  // Points + day labels (label and unit come from the database -> textContent)
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

// ----- Records table -----
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

// ----- Team list -----
function showTeam(list) {
  const box = $("team-list");
  if (!list || !list.length) {
    showEmpty(box, "No data loaded");
    return;
  }

  box.replaceChildren(); // clear the list

  list.forEach((m, i) => {
    const item = makeEl("div", "team-item" + (i === 0 ? " active" : ""));

    // Photo, or first letter of the name if there is no photo
    if (m.photo) {
      const img = makeEl("img", "avatar");
      img.src = m.photo;
      img.alt = m.name;
      item.appendChild(img);
    } else {
      item.appendChild(makeEl("div", "avatar", (m.name || "?")[0]));
    }

    const info = makeEl("div", "info");
    info.appendChild(makeEl("strong", "", m.name));
    item.appendChild(info);

    const value = makeEl("div", "value");
    value.appendChild(makeEl("i", "dot " + safeClass(m.status, ALLOWED_STATUS)));
    value.append(" " + m.value);
    value.appendChild(makeEl("small", "", m.unit));
    item.appendChild(value);

    box.appendChild(item);
  });
}

function showAll(d) {
  showUser(d.user);
  $("data-source").textContent = d.source || "--";
  showChart(d.chart);
  showRecords(d.records);
  showTeam(d.team);
}

// ================= SELECTED INDICATOR: title + ICON =================
function updateIndicatorUI(indicator) {
  const cfg = INDICATORS[indicator];
  $("chart-title").textContent = cfg.label;
  $("team-title").textContent = "Team: " + cfg.label;

  const icon = $("indicator-icon");
  if (cfg.icon) { icon.src = cfg.icon; icon.style.display = ""; }
  else { icon.style.display = "none"; }
}

// ================= LOAD =================
let requestId = 0;

async function loadHistory() {
  const indicator = $("indicator-filter").value;
  const days = $("period-filter").value;
  updateIndicatorUI(indicator);

  const current = ++requestId;
  showEmpty($("chart"), "Loading...");

  try {
    const data = await getHistoryData(indicator, days);
    if (current !== requestId) return;
    showAll(data);
  } catch (err) {
    console.error("Could not load history:", err);
    if (current !== requestId) return;
    showChart(null); showRecords(null); showTeam(null);
  }
}

$("indicator-filter").addEventListener("change", loadHistory);
$("period-filter").addEventListener("change", loadHistory);
$("export-btn").addEventListener("click", () => alert("Export will be connected to the backend."));
$("details-btn").addEventListener("click", () => alert("Details view pending."));

// ================= CUSTOM DROPDOWNS =================
document.querySelectorAll(".select-box").forEach((box) => {
  const sel = box.querySelector("select");
  const label = document.createElement("button");
  label.type = "button";
  label.className = "select-label";
  label.textContent = sel.options[sel.selectedIndex].text;

  const menu = document.createElement("ul");
  menu.className = "select-menu";
  [...sel.options].forEach((o) => {
    const li = document.createElement("li");
    li.textContent = o.text;
    li.addEventListener("click", () => {
      sel.value = o.value;
      label.textContent = o.text;
      box.classList.remove("open");
      sel.dispatchEvent(new Event("change"));
    });
    menu.appendChild(li);
  });

  box.append(label, menu);
  label.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".select-box.open").forEach((b) => { if (b !== box) b.classList.remove("open"); });
    box.classList.toggle("open");
  });
});
document.addEventListener("click", () =>
  document.querySelectorAll(".select-box.open").forEach((b) => b.classList.remove("open")));

loadHistory();