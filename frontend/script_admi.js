// =====================================================
//  ADMIN HISTORY (read-only)
//  Teammates: only edit the "DATA SOURCE" section.
// =====================================================

const $ = (id) => document.getElementById(id);

// ================= DATA SOURCE (TEAMMATES EDIT HERE) =================
const API_URL = null;            // e.g. "http://localhost:3000/api"
const USE_SAMPLE_DATA = true;    // set to false when the real API works

/** getCrew() -> [{ id, name, role, status: "normal"|"follow"|"attention", photo }] */
async function getCrew() {
  if (USE_SAMPLE_DATA || !API_URL) return SAMPLE_CREW;
  const res = await fetch(`${API_URL}/crew`);
  if (!res.ok) throw new Error("Status " + res.status);
  return res.json();
}

/**
 * getMemberHistory(id, days) -> {
 *   series: { hr|spo2|bp|glucose|temp: { unit, range: {min, max}, points: [{ label, value }] } },
 *   records: [{ datetime, indicator, value, source: "sensor"|"manual", notes }]
 * }
 */
async function getMemberHistory(id, days) {
  if (USE_SAMPLE_DATA || !API_URL) return buildSampleHistory(id, days);
  const res = await fetch(`${API_URL}/crew/${id}/history?days=${days}`);
  if (!res.ok) throw new Error("Status " + res.status);
  return res.json();
}

// ================= INDICATORS =================
const INDICATORS = {
  hr:      { label: "Heart rate",       unit: "BPM",   range: { min: 60, max: 100 },  base: 72,   spread: 10 },
  spo2:    { label: "SpO₂",             unit: "%",     range: { min: 95, max: 100 },  base: 98,   spread: 2 },
  bp:      { label: "Blood pressure",   unit: "mmHg",  range: { min: 90, max: 120 },  base: 118,  spread: 8 },
  glucose: { label: "Glucose",          unit: "mg/dL", range: { min: 70, max: 100 },  base: 92,   spread: 8 },
  temp:    { label: "Body temperature", unit: "°C",    range: { min: 36, max: 37.5 }, base: 36.8, spread: 0.6 },
};

// ================= SAMPLE DATA (delete when the API works) =================
const SAMPLE_CREW = [
  { id: 1, name: "Elena Torres", role: "Commander",       status: "normal",    photo: null },
  { id: 2, name: "Marco Silva",  role: "Pilot",           status: "normal",    photo: null },
  { id: 3, name: "Mei Chen",     role: "Flight engineer", status: "follow",    photo: null },
  { id: 4, name: "Daniel Kim",   role: "Mission doctor",  status: "attention", photo: null },
];

function buildSampleHistory(id, days) {
  const n = Math.min(Number(days), 10);
  const today = 84;
  const series = {};
  const records = [];
  Object.entries(INDICATORS).forEach(([key, cfg]) => {
    const points = [];
    for (let i = n - 1; i >= 0; i--) {
      const wave = Math.sin((today - i) * 1.7 + id) * cfg.spread;
      points.push({ label: "Day " + (today - i), value: Math.round((cfg.base + wave) * 10) / 10 });
    }
    series[key] = { unit: cfg.unit, range: cfg.range, points };
    points.slice(-3).reverse().forEach((p, i) => {
      records.push({
        datetime: `${p.label} · ${["09:15", "21:30", "08:45"][i]}`,
        indicator: cfg.label,
        value: (key === "bp" ? `${Math.round(p.value)}/76` : p.value) + " " + cfg.unit,
        source: i === 2 ? "manual" : "sensor",
        notes: "",
      });
    });
  });
  return { series, records };
}

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
    <div class="team-item ${m.id === selectedId ? "active" : ""}" data-id="${m.id}">
      ${m.photo ? `<img class="avatar" src="${m.photo}" alt="${m.name}">` : `<div class="avatar">${m.name[0]}</div>`}
      <div class="info"><strong>${m.name}</strong><div class="role">${m.role || ""}</div></div>
      <div class="value"><i class="dot ${m.status}"></i></div>
    </div>`).join("");
  box.querySelectorAll(".team-item").forEach((el) =>
    el.addEventListener("click", () => selectMember(Number(el.dataset.id))));
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
    svg += `<circle class="data-point" cx="${x(i)}" cy="${y(p.value)}" r="4.5"><title>${p.label} - ${p.value} ${chart.unit || ""}</title></circle>
            <text class="label" x="${x(i)}" y="${H - 8}" text-anchor="middle">${p.label}</text>`;
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
      <td>${r.datetime}</td>
      <td>${r.indicator}</td>
      <td>${r.value}</td>
      <td><span class="source-tag"><i class="dot ${r.source}"></i> ${r.source === "manual" ? "Manual" : "Sensor"}</span></td>
      <td>${r.notes || ""}</td>
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
  // keep the URL in sync so refresh / share keeps the same person
  history_replaceUrl(id);
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
  try {
    crew = await getCrew();
  } catch (err) {
    console.error("Could not load crew:", err);
    crew = [];
  }
  showCrew();
  const idFromUrl = Number(new URLSearchParams(location.search).get("id"));
  const valid = crew.some((c) => c.id === idFromUrl);
  if (crew.length) selectMember(valid ? idFromUrl : crew[0].id);
})();