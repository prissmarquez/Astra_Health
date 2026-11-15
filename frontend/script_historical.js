
const $ = (id) => document.getElementById(id);

const INDICATORS = {
  hr:      { label: "Heart rate",                unit: "BPM",   column: "heart_rate",        range: { min: 50, max: 100 }, icon: "assets/recourse2.png" },
  spo2:    { label: "SpO₂",                      unit: "%",     column: "spo2",              range: { min: 95, max: 100 }, icon: "assets/oxigen.png" },
  bp:      { label: "Blood pressure (systolic)", unit: "mmHg",  column: "systolic_pressure", range: { min: 90, max: 129 }, icon: "assets/BP.jpg",
             extraColumn: "diastolic_pressure" },
  glucose: { label: "Glucose",                   unit: "mg/dL", column: "glucose",           range: { min: 55, max: 180 }, icon: "assets/gluco.png" },
  temp:    { label: "Body temperature",          unit: "°C",    column: "temperature",       range: { min: 35, max: 38 },  icon: null },
};


function classifyValue(indicator, value, extra) {
  if (value == null) return "";
  const v = Number(value);
  const rules = {
    hr:      () => (v > 120 || v < 40) ? "attention" : (v > 100 || v < 50) ? "follow" : "normal",
    spo2:    () => v < 92 ? "attention" : v < 95 ? "follow" : "normal",
    bp:      () => {
      const d = extra == null ? 0 : Number(extra);
      if (v >= 140 || d >= 90 || v < 85) return "attention";
      if (v >= 130 || d >= 85 || v < 90) return "follow";
      return "normal";
    },
    glucose: () => (v < 54 || v > 250) ? "attention" : (v < 55 || v > 180) ? "follow" : "normal",
    temp:    () => v >= 39 ? "attention" : v >= 38 ? "follow" : "normal",
  };
  return rules[indicator] ? rules[indicator]() : "";
}

const STATUS_FROM_LIGHT = { green: "normal", yellow: "follow", red: "attention" };
const LIGHT_TEXT = { green: "Normal", yellow: "Follow-up", red: "Needs attention" };


let me = null;          // signed-in profile
let mates = [];         // crew_latest rows (all indicators) for my crewmates
let targetId = null;    // whose history is on screen
let requestId = 0;
let liveChannel = null;

const isLeader = () => me && me.role === "leader";

function sinceDate(days) {
  return new Date(Date.now() - Number(days) * 86400000);
}




async function fetchDaily(astronautId, days) {
  const { data, error } = await supabaseClient
    .from("daily_readings")
    .select("day, heart_rate, spo2, systolic_pressure, diastolic_pressure, glucose, temperature, adaptation")
    .eq("astronaut_id", astronautId)
    .gte("day", utcDay(sinceDate(days)))
    .order("day", { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

// Every measurement of the chosen indicator -> "Detailed log"
async function fetchRecords(astronautId, indicator, days) {
  const cfg = INDICATORS[indicator];
  const codes = cfg.extraColumn ? [cfg.column, cfg.extraColumn] : [cfg.column];
  const { data, error } = await supabaseClient
    .from("readings_detailed")
    .select("taken_at, indicator_name, value, unit, source, sensor_name, context")
    .eq("astronaut_id", astronautId)
    .eq("status", "taken")
    .in("indicator", codes)
    .gte("taken_at", sinceDate(days).toISOString())
    .order("taken_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data;
}


async function fetchAnalyses(astronautId, days) {
  const { data, error } = await supabaseClient
    .from("health_analyses")
    .select("day, traffic_light, clinical_reasons, deviations, detected_by_ml, analyzed_at")
    .eq("astronaut_id", astronautId)
    .gte("day", utcDay(sinceDate(days)))
    .order("analyzed_at", { ascending: false });
  if (error) throw new Error(error.message);
  const byDay = {};
  for (const a of data) {
    if (!byDay[a.day]) byDay[a.day] = a;
  }
  return byDay;
}

// Crewmates' latest value of every indicator (security definer RPC, migration 011)
async function fetchTeam() {
  const { data, error } = await supabaseClient.rpc("crew_latest", { p_indicator: null });
  if (error) throw new Error(error.message);
  return data;
}



function makeEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function showEmpty(box, text) {
  box.replaceChildren(makeEl("p", "empty", text));
}

const ALLOWED_SOURCES = ["sensor", "manual"];
const ALLOWED_STATUS = ["normal", "follow", "attention"];

function safeClass(value, allowed) {
  return allowed.includes(value) ? value : "";
}

const round1 = (v) => Math.round(Number(v) * 10) / 10;

// ----- Chart (SVG) -----
const SVG_NS = "http://www.w3.org/2000/svg";

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

  for (let i = 0; i <= 4; i++) {
    const v = min + ((max - min) * i) / 4;
    svg.appendChild(makeSvg("line", { class: "axis", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    const label = makeSvg("text", { class: "label", x: L - 6, y: y(v) + 4, "text-anchor": "end" });
    label.textContent = Math.round(v * 10) / 10;
    svg.appendChild(label);
  }

  if (chart.range) {
    svg.appendChild(makeSvg("rect", {
      class: "range-band",
      x: L,
      y: y(chart.range.max),
      width: W - L - R,
      height: y(chart.range.min) - y(chart.range.max)
    }));
  }

  const path = vals.map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`).join(" ");
  svg.appendChild(makeSvg("path", { class: "series", d: path }));

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

  body.replaceChildren();

  rows.forEach((r) => {
    const tr = makeEl("tr");
    tr.appendChild(makeEl("td", "", r.datetime));
    tr.appendChild(makeEl("td", "", r.indicator));
    tr.appendChild(makeEl("td", "", r.value));

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


function showStatus(rows) {
  const body = $("status-body");
  if (!rows || !rows.length) {
    const tr = makeEl("tr");
    const td = makeEl("td", "empty", "No records");
    td.colSpan = 4;
    tr.appendChild(td);
    body.replaceChildren(tr);
    return;
  }

  body.replaceChildren();

  rows.forEach((r) => {
    const tr = makeEl("tr");
    tr.appendChild(makeEl("td", "", formatDay(r.day)));  // UTC day of the analysis

    const statusTd = makeEl("td");
    if (r.light) {
      statusTd.appendChild(makeEl("i", "dot " + safeClass(STATUS_FROM_LIGHT[r.light], ALLOWED_STATUS)));
      statusTd.append(" " + (LIGHT_TEXT[r.light] || r.light));
    } else {
      statusTd.textContent = "--";
    }
    tr.appendChild(statusTd);

    tr.appendChild(makeEl("td", "", r.adaptation == null ? "--" : Math.round(r.adaptation * 100) + "%"));
    tr.appendChild(makeEl("td", "", r.reasons.length ? r.reasons.join("; ") : "--"));
    body.appendChild(tr);
  });
}


function showTeam(list) {
  const box = $("team-list");
  if (!list || !list.length) {
    showEmpty(box, me && me.crew_id ? "No crewmates yet" : "You are not in a crew yet");
    return;
  }

  box.replaceChildren();

  list.forEach((m) => {
    const item = makeEl("div", "team-item" + (m.id === targetId ? " active" : ""));
    item.appendChild(makeEl("div", "avatar", (m.name || "?")[0]));

    const info = makeEl("div", "info");
    info.appendChild(makeEl("strong", "", m.name));
    item.appendChild(info);

    const value = makeEl("div", "value");
    if (m.value == null) {
      value.append("--");
    } else {
      value.appendChild(makeEl("i", "dot " + safeClass(m.status, ALLOWED_STATUS)));
      value.append(" " + m.value);
      value.appendChild(makeEl("small", "", m.unit));
    }
    item.appendChild(value);

    // Only the leader can open a crewmate's full history
    if (isLeader()) {
      item.style.cursor = "pointer";
      item.tabIndex = 0;
      item.setAttribute("role", "button");
      item.title = "View " + m.name + "'s history";
      item.addEventListener("click", () => viewMember(m.id));
      item.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); viewMember(m.id); }
      });
    }

    box.appendChild(item);
  });
}


// crew_latest rows -> one entry per crewmate for the chosen indicator
function teamFor(indicator) {
  const cfg = INDICATORS[indicator];
  const people = new Map();
  for (const row of mates) {
    if (!people.has(row.astronaut_id)) {
      people.set(row.astronaut_id, {
        id: row.astronaut_id,
        name: row.astronaut || row.astronaut_code || "?",
        main: null,
        extra: null,
      });
    }
    const p = people.get(row.astronaut_id);
    if (row.indicator === cfg.column) p.main = row.value;
    if (cfg.extraColumn && row.indicator === cfg.extraColumn) p.extra = row.value;
  }
  return [...people.values()].map((p) => ({
    id: p.id,
    name: p.name,
    value: p.main == null ? null
      : cfg.extraColumn && p.extra != null ? `${Math.round(p.main)}/${Math.round(p.extra)}` : round1(p.main),
    unit: cfg.unit,
    status: classifyValue(indicator, p.main, p.extra),
  }));
}

function mateName(id) {
  const row = mates.find((m) => m.astronaut_id === id);
  return row ? (row.astronaut || row.astronaut_code || "crewmate") : "crewmate";
}

function buildChart(indicator, daily) {
  const cfg = INDICATORS[indicator];
  return {
    unit: cfg.unit,
    range: cfg.range,
    points: daily
      .filter((d) => d[cfg.column] != null)
      .map((d) => ({ label: formatDay(d.day, { month: "short", day: "numeric" }), value: round1(d[cfg.column]) })),
  };
}

function buildRecords(rows) {
  return rows.map((r) => ({
    datetime: formatLocalDateTime(r.taken_at),
    indicator: r.indicator_name,
    value: `${round1(r.value)} ${r.unit}`,
    source: ["manual", "questionnaire"].includes(r.source) ? "manual" : "sensor",
    notes: r.context || r.sensor_name || "",
  }));
}

function buildStatus(daily, analysesByDay) {
  const days = new Map();
  for (const d of daily) {
    days.set(d.day, { day: d.day, light: null, reasons: [], adaptation: d.adaptation });
  }
  for (const [day, a] of Object.entries(analysesByDay)) {
    const row = days.get(day) || { day, light: null, reasons: [], adaptation: null };
    row.light = a.traffic_light;
    row.reasons = [...(a.clinical_reasons || []), ...(a.deviations || []).map((d) => "vs normal: " + d)];
    if (a.detected_by_ml) row.reasons.push("unusual pattern (ML)");
    days.set(day, row);
  }
  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1));  // newest first
}



function showMe() {
  $("user-name").textContent = me.name || me.astronaut_code || "Astronaut";
  $("user-role").textContent = [me.astronaut_code, me.role].filter(Boolean).join(" · ");
}

function showViewing() {
  const mine = targetId === me.id;
  $("viewing-banner").style.display = mine ? "none" : "";
  $("viewing-text").textContent = mine ? "" : "Viewing data of " + mateName(targetId) + " (live)";
  $("history-subtitle").textContent = mine
    ? "Explore your records and discover trends"
    : "Health history of " + mateName(targetId);
}


function updateIndicatorUI(indicator) {
  const cfg = INDICATORS[indicator];
  $("chart-title").textContent = cfg.label;
  $("team-title").textContent = "Team: " + cfg.label;

  const icon = $("indicator-icon");
  if (cfg.icon) { icon.src = cfg.icon; icon.style.display = ""; }
  else { icon.style.display = "none"; }
}


async function loadHistory() {
  const indicator = $("indicator-filter").value;
  const days = $("period-filter").value;
  updateIndicatorUI(indicator);
  showViewing();
  if (!targetId) return;

  const current = ++requestId;
  const who = targetId;
  showEmpty($("chart"), "Loading...");

  try {
    const [daily, records, analyses] = await Promise.all([
      fetchDaily(who, days),
      fetchRecords(who, indicator, days),
      fetchAnalyses(who, days),
    ]);
    if (current !== requestId) return;  // a newer request is running
    showChart(buildChart(indicator, daily));
    showRecords(buildRecords(records));
    showStatus(buildStatus(daily, analyses));
    $("data-source").textContent = "Supabase · live updates";
  } catch (err) {
    console.error("Could not load history:", err);
    if (current !== requestId) return;
    showEmpty($("chart"), navigator.onLine ? "Could not load data" : "Offline: history needs a connection");
    showRecords(null);
    showStatus(null);
    $("data-source").textContent = navigator.onLine ? "--" : "Offline";
  }
}

async function loadTeam() {
  try {
    mates = await fetchTeam();
  } catch (err) {
    console.error("Could not load team:", err);
    mates = [];
  }
  showTeam(teamFor($("indicator-filter").value));
}



// Leader -> only crewmates; crew -> always themselves (?id= is ignored).
function allowedTarget(id) {
  if (!id || id === me.id) return me.id;
  if (isLeader() && mates.some((m) => m.astronaut_id === id)) return id;
  return me.id;
}

function setUrlId(id) {
  const url = new URL(location.href);
  if (id && id !== me.id) url.searchParams.set("id", id);
  else url.searchParams.delete("id");
  window.history.replaceState({}, "", url);
}

function viewMember(id) {
  targetId = allowedTarget(id);
  setUrlId(targetId);
  showTeam(teamFor($("indicator-filter").value));  // move the "active" highlight
  subscribeLive();
  loadHistory();
}

$("back-to-mine").addEventListener("click", () => viewMember(me.id));


let reloadTimer = null;
const pendingReload = { history: false, team: false };

function scheduleReload(part) {
  pendingReload[part] = true;
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    if (pendingReload.team) loadTeam();
    if (pendingReload.history) loadHistory();
    pendingReload.history = pendingReload.team = false;
  }, 800);
}

function subscribeLive() {
  if (liveChannel) supabaseClient.removeChannel(liveChannel);
  const who = targetId;
  liveChannel = supabaseClient
    .channel("history-" + who)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "measurements" }, (payload) => {
      if (payload.new && payload.new.user_id === who) scheduleReload("history");
      scheduleReload("team");
    })
    .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "health_analyses", filter: "astronaut_id=eq." + who },
        () => scheduleReload("history"))
    .subscribe();
}


$("indicator-filter").addEventListener("change", () => {
  showTeam(teamFor($("indicator-filter").value));  // same data, other indicator
  loadHistory();
});
$("period-filter").addEventListener("change", loadHistory);
$("export-btn").addEventListener("click", () => alert("Export will be connected to the backend."));
$("details-btn").addEventListener("click", () => alert("Details view pending."));


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


connectLogoutButton();  // from supabase_client.js (no-op without #logout-btn)

(async function init() {
  me = await requireRole(["crew", "leader"]);  // auth_guard.js
  if (!me) return;
  showMe();

  await loadTeam();  // needed first: the leader's ?id= must be one of these crewmates
  const idFromUrl = new URLSearchParams(location.search).get("id");
  viewMember(idFromUrl);
})();
