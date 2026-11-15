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
function showUser(u) {
  if (!u) return;
  $("user-name").textContent = u.name;
  $("user-role").textContent = u.role;
  if (u.photo) document.querySelector(".foto-perfil").src = u.photo;
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

function showTeam(list) {
  const box = $("team-list");
  if (!list || !list.length) { box.innerHTML = '<p class="empty">No data loaded</p>'; return; }
  box.innerHTML = list.map((m, i) => `
    <div class="team-item ${i === 0 ? "active" : ""}">
      ${m.photo ? `<img class="avatar" src="${m.photo}" alt="${m.name}">` : `<div class="avatar">${m.name[0]}</div>`}
      <div class="info"><strong>${m.name}</strong></div>
      <div class="value"><i class="dot ${m.status}"></i> ${m.value}<small>${m.unit}</small></div>
    </div>`).join("");
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
  $("chart").innerHTML = '<p class="empty">Loading...</p>';

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