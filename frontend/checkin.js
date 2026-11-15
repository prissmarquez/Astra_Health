// ===== ASTRA HEALTH - Check-in page =====
// Needs (loaded before this file): supabase-js@2 and supabase_client.js
// (supabaseClient, API_URL, getProfile, loadQueue, saveQueue, updateConnectionStatus...).

// Profile of the signed-in user (set on page load). Its id is the owner of new readings.
let currentProfile = null;

// ===== Simulated sensors =====
// There is no real sensor yet, so each "Measure" generates a random value.
// Assumed ranges, inside the green zone of backend/ml/health_engine.py.
// Glucose: NASA Inspiration4 pre-flight values.
const SIMULATED_RANGES = {
  heart_rate:         { min: 55,   max: 80,   decimals: 0, unit: "bpm" },
  hrv:                { min: 35,   max: 75,   decimals: 0, unit: "ms" },
  spo2:               { min: 96,   max: 99,   decimals: 0, unit: "%" },
  temperature:        { min: 36.5, max: 37.2, decimals: 1, unit: "°C" },
  systolic_pressure:  { min: 105,  max: 125,  decimals: 0, unit: "mmHg" },
  diastolic_pressure: { min: 65,   max: 80,   decimals: 0, unit: "mmHg" },
  glucose:            { min: 71,   max: 90,   decimals: 0, unit: "mg/dL" }
};

// The 7 values the reading needs (same names as OfflineReading in backend/main.py)
const REQUIRED_MEASUREMENTS = Object.keys(SIMULATED_RANGES);

// Values measured on this page, e.g. { heart_rate: 68, spo2: 97, ... }
const measured = {};

function randomBetween(min, max, decimals) {
  const factor = Math.pow(10, decimals);
  const value = min + Math.random() * (max - min);
  return Math.round(value * factor) / factor;
}

function simulateField(field) {
  const range = SIMULATED_RANGES[field];
  measured[field] = randomBetween(range.min, range.max, range.decimals);
  return measured[field];
}

// Text for one button from `measured`, e.g. "68 bpm" or "115/75 mmHg".
// Returns null if that sensor has not been measured yet.
function formatSensor(sensor) {
  if (sensor === "blood_pressure") {
    const systolic = measured.systolic_pressure;
    const diastolic = measured.diastolic_pressure;
    if (typeof systolic !== "number" || typeof diastolic !== "number") return null;
    return systolic + "/" + diastolic + " mmHg";
  }
  if (typeof measured[sensor] !== "number" || !SIMULATED_RANGES[sensor]) return null;
  return measured[sensor] + " " + SIMULATED_RANGES[sensor].unit;
}

// Fills `measured` for one button and returns the text to show
function simulateSensor(sensor) {
  if (sensor === "blood_pressure") {
    simulateField("systolic_pressure");
    simulateField("diastolic_pressure");
  } else {
    simulateField(sensor);
  }
  return formatSensor(sensor);
}

// ===== Keep measured values across page changes (e.g. going to panas.html) =====
const MEASURED_KEY = "astra_measured";

function saveMeasured() {
  try {
    sessionStorage.setItem(MEASURED_KEY, JSON.stringify(measured));
  } catch (error) {
    // Storage blocked: values only live on this page
  }
}

function clearMeasured() {
  try {
    sessionStorage.removeItem(MEASURED_KEY);
  } catch (error) {
    // Nothing to clear
  }
}

// Loads saved values into `measured` (only known fields with valid numbers)
function loadMeasured() {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(MEASURED_KEY));
  } catch (error) {
    return;
  }
  if (!saved || typeof saved !== "object") return;

  REQUIRED_MEASUREMENTS.forEach(function (field) {
    if (typeof saved[field] === "number" && Number.isFinite(saved[field])) {
      measured[field] = saved[field];
    }
  });
}

function showMeasuredStatus(button, text) {
  const status = button.parentElement.querySelector(".measure-status");
  button.disabled = false;
  button.textContent = "Measure again";
  status.textContent = text + " ✓ (simulated)";
  status.classList.add("done");
}

// ===== Measurement buttons =====
// Show a spinning circle for 5 seconds, then a simulated value.
const measureButtons = document.querySelectorAll(".measure-btn");

measureButtons.forEach(function (button) {
  button.addEventListener("click", function () {
    const status = button.parentElement.querySelector(".measure-status");

    // "Connecting..." text with a small spinning circle (fixed HTML, no user data)
    button.disabled = true;
    button.innerHTML = 'Connecting... <span class="spinner"></span>';
    status.textContent = "Connecting to sensor";
    status.classList.remove("done");

    // Wait 5 seconds (5000 ms)
    setTimeout(function () {
      const text = simulateSensor(button.dataset.sensor);
      saveMeasured();
      showMeasuredStatus(button, text);
    }, 5000);
  });
});

// Restore values measured before leaving the page
loadMeasured();
measureButtons.forEach(function (button) {
  const text = formatSensor(button.dataset.sensor);
  if (text) {
    showMeasuredStatus(button, text);
  }
});

// ===== PANAS card =====
// Shows if the questionnaire was already completed (saved by panas.js)
const panasState = document.getElementById("panasState");
const panasBtn = document.getElementById("panasBtn");

// Returns { positive, negative } or null
function getPanasResult() {
  try {
    const result = JSON.parse(sessionStorage.getItem("panasResult"));
    if (result && typeof result.positive === "number" && typeof result.negative === "number") {
      return result;
    }
  } catch (error) {
    // Broken value: treat as not completed
  }
  return null;
}

function showPanasState() {
  const panasResult = getPanasResult();
  if (panasResult) {
    panasState.textContent = "Completed ✓  Positive: " + panasResult.positive +
                             "/50 · Negative: " + panasResult.negative + "/50";
    panasState.classList.add("done");
    panasBtn.textContent = "Answer again →";
  } else {
    panasState.textContent = "Not completed";
    panasState.classList.remove("done");
    panasBtn.textContent = "Start questionnaire →";
  }
}

showPanasState();

// ===== Keep exercise + sleep answers across page changes =====
const FORM_KEY = "astra_checkin_form";
const SLEEP_FIELDS = ["sleepHours", "sleepMinutes", "sleepNotes"];
const exerciseRadios = document.querySelectorAll('input[name="exercise"]');

function saveForm() {
  const exercise = document.querySelector('input[name="exercise"]:checked');
  const form = { exercise: exercise ? exercise.value : null };
  SLEEP_FIELDS.forEach(function (id) {
    form[id] = document.getElementById(id).value;
  });
  try {
    sessionStorage.setItem(FORM_KEY, JSON.stringify(form));
  } catch (error) {
    // Storage blocked: answers only live on this page
  }
}

function clearForm() {
  try {
    sessionStorage.removeItem(FORM_KEY);
  } catch (error) {
    // Nothing to clear
  }
}

// Fills the inputs with the saved answers (values only, never HTML)
function restoreForm() {
  let form = null;
  try {
    form = JSON.parse(sessionStorage.getItem(FORM_KEY));
  } catch (error) {
    return;
  }
  if (!form || typeof form !== "object") return;

  if (form.exercise === "yes" || form.exercise === "no") {
    exerciseRadios.forEach(function (radio) {
      radio.checked = radio.value === form.exercise;
    });
  }
  SLEEP_FIELDS.forEach(function (id) {
    if (typeof form[id] === "string") {
      document.getElementById(id).value = form[id];
    }
  });
}

restoreForm();
exerciseRadios.forEach(function (radio) {
  radio.addEventListener("change", saveForm);
});
SLEEP_FIELDS.forEach(function (id) {
  document.getElementById(id).addEventListener("input", saveForm);
});

// ===== Sleep: convert hours + minutes to sleep_min =====
// Returns null if both fields are empty.
function getSleepMinutes() {
  const hours = document.getElementById("sleepHours").value;
  const minutes = document.getElementById("sleepMinutes").value;

  if (hours === "" && minutes === "") {
    return null;
  }

  return Number(hours) * 60 + Number(minutes);
}

// ===== UUID v4 =====
// crypto.randomUUID only exists in secure contexts (https or localhost),
// so build one with crypto.getRandomValues when it is missing.
function newUuid() {
  if (window.crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, function (b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" +
         hex.slice(16, 20) + "-" + hex.slice(20);
}

// ===== Validation =====
// Returns an error text, or null if everything is ready.
function validateCheckin() {
  const missing = REQUIRED_MEASUREMENTS.filter(function (field) {
    return typeof measured[field] !== "number";
  });
  if (missing.length > 0) {
    return "Please take all measurements first (missing: " + missing.join(", ") + ").";
  }

  if (!document.querySelector('input[name="exercise"]:checked')) {
    return "Please tell us if you exercised today.";
  }

  const hours = document.getElementById("sleepHours").value;
  const minutes = document.getElementById("sleepMinutes").value;
  const sleepMin = getSleepMinutes();

  if (sleepMin === null) {
    return "Please enter your sleep duration.";
  }
  if (minutes !== "" && (Number(minutes) < 0 || Number(minutes) > 59)) {
    return "Sleep minutes must be between 0 and 59.";
  }
  if (Number.isNaN(sleepMin) || Number(hours) < 0 || sleepMin < 0 || sleepMin > 1440) {
    return "Sleep time must be between 0 and 24 hours.";
  }

  if (!getPanasResult()) {
    return "Please complete the mood questionnaire (PANAS) first.";
  }

  return null;
}

// ===== Reading saved in the queue =====
// EXACTLY the field names of OfflineReading in backend/main.py, plus owner_id
// (only used on this device; it is removed before sending, the server uses the token).
// sleepNotes is not sent: /sync has no field for it.
function buildReading(ownerId) {
  const exercise = document.querySelector('input[name="exercise"]:checked');
  const panasResult = getPanasResult();

  return {
    owner_id: ownerId,
    id: newUuid(),
    taken_at: new Date().toISOString(),
    heart_rate: measured.heart_rate,
    hrv: measured.hrv,
    spo2: measured.spo2,
    temperature: measured.temperature,
    systolic_pressure: measured.systolic_pressure,
    diastolic_pressure: measured.diastolic_pressure,
    glucose: measured.glucose,
    sleep_min: getSleepMinutes(),
    positive_mood: panasResult.positive,
    negative_mood: panasResult.negative,
    exercising: exercise.value === "yes",
    is_simulated: true
  };
}

// ===== Offline queue (loadQueue / saveQueue live in supabase_client.js) =====
function addToQueue(reading) {
  const queue = loadQueue();
  queue.push(reading);
  saveQueue(queue);
  updateConnectionStatus();
}

// Copy of a reading without owner_id, ready for POST /sync
function toSyncPayload(reading) {
  const payload = Object.assign({}, reading);
  delete payload.owner_id;
  return payload;
}

// ===== Preliminary traffic light =====
// Port of health_engine.clinical() with adaptation = 0 (no mission data here).
// The server result replaces it once /sync answers.
function clinicalPreview(r) {
  let level = 0;
  const reasons = [];
  const adaptation = 0;
  const expectedTemp = 37.0 + 1.0 * adaptation; // Stahn 2017
  const expectedSys = 115 - 8 * adaptation;     // Norsk 2015

  function flag(red, yellow, text) {
    if (red) {
      level = 2;
      reasons.push(text);
    } else if (yellow) {
      level = Math.max(level, 1);
      reasons.push(text);
    }
  }

  // SpO2: BTS oxygen guideline
  flag(r.spo2 < 92, r.spo2 < 95, "low SpO2");

  if (r.exercising) {
    // During exercise core temp >40 °C is common in space: alert only extreme values
    flag(r.temperature > 40.5, false, "very high temperature during exercise");
  } else {
    flag(r.temperature >= expectedTemp + 2.0, r.temperature >= expectedTemp + 1.0,
         "high temperature");
    flag(r.heart_rate > 120 || r.heart_rate < 40, r.heart_rate > 100 || r.heart_rate < 50,
         "HR out of range");
  }

  // High BP: red ACC/AHA 2017 stage 2, yellow ESC/ESH 2018 high-normal
  flag(r.systolic_pressure >= 140 || r.diastolic_pressure >= 90,
       r.systolic_pressure >= 130 || r.diastolic_pressure >= 85,
       "high pressure");
  // Low BP, relative to expected pressure
  flag(r.systolic_pressure < expectedSys - 30, r.systolic_pressure < expectedSys - 25,
       "low pressure");
  // Glucose: hypoglycemia (Cryer 2009 / ADA level 2) and hyperglycemia
  flag(r.glucose < 54 || r.glucose > 250, r.glucose < 55 || r.glucose > 180,
       "glucose out of range");

  // Sleep: the server uses the 7-night mean; here we only have one night,
  // so it is an advisory and never changes the level.
  if (r.sleep_min < 300) {
    reasons.push("advisory: slept less than 5 h");
  } else if (r.sleep_min < 360) {
    reasons.push("advisory: slept less than 6 h");
  }

  return {
    traffic_light: ["green", "yellow", "red"][level],
    clinical_reasons: reasons,
    deviations: [],
    connections: [],
    detected_by_ml: false
  };
}

// ===== Finish message =====
// Everything is written with textContent: server data never goes through innerHTML.
const finishBtn = document.getElementById("finishBtn");
const finishMessage = document.getElementById("finishMessage");

const LIGHT_ICONS = { green: "🟢", yellow: "🟡", red: "🔴" };

function showFinishError(text) {
  finishMessage.textContent = text;
  finishMessage.className = "finish-message error";
}

function showFinishInfo(text) {
  finishMessage.textContent = text;
  finishMessage.className = "finish-message";
}

function appendLine(text) {
  if (finishMessage.childNodes.length > 0) {
    finishMessage.appendChild(document.createElement("br"));
  }
  finishMessage.appendChild(document.createTextNode(text));
}

function listOrNone(items) {
  return Array.isArray(items) && items.length > 0 ? items.join("; ") : "none";
}

// title: e.g. "Preliminary result" / "Result"; note: optional extra line
function showTrafficLight(title, analysis, note) {
  const light = String(analysis.traffic_light);
  finishMessage.textContent = "";
  finishMessage.className = light === "red" ? "finish-message error" : "finish-message";

  appendLine((LIGHT_ICONS[light] || "⚪") + " " + title + ": " + light.toUpperCase());
  appendLine("Clinical reasons: " + listOrNone(analysis.clinical_reasons));
  appendLine("Deviations: " + listOrNone(analysis.deviations));
  appendLine("Connections: " + listOrNone(analysis.connections));
  appendLine("Detected by ML: " + (analysis.detected_by_ml ? "yes" : "no"));
  if (note) {
    appendLine(note);
  }
}

// ===== Sync with the backend =====
// Sends ONLY the signed-in user's readings to POST /sync and removes the ids that came back ok.
// Other users' readings and old readings without owner_id stay in the queue untouched.
// The server decides the owner from the token, never from owner_id.
// Returns the server results, or throws if the request failed (queue untouched).
let syncing = false;

async function syncQueue() {
  if (syncing) return null;
  if (loadQueue().length === 0) return [];

  syncing = true;
  try {
    // Same user as the token we send
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      throw new Error("Session expired, please log in again.");
    }
    const userId = session.user.id;

    const queue = loadQueue();
    const withoutOwner = queue.filter(function (reading) { return !reading.owner_id; });
    if (withoutOwner.length > 0) {
      console.warn(withoutOwner.length + " queued reading(s) have no owner_id; " +
                   "they are kept in the queue and not uploaded.");
    }
    const mine = queue.filter(function (reading) { return reading.owner_id === userId; });
    if (mine.length === 0) return [];

    const response = await fetch(API_URL + "/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + session.access_token
      },
      body: JSON.stringify(mine.map(toSyncPayload))
    });

    if (!response.ok) {
      throw new Error("Server error (" + response.status + ")");
    }

    const results = await response.json();
    const okIds = new Set(
      results.filter(function (item) { return item.ok; })
             .map(function (item) { return String(item.id).toLowerCase(); })
    );

    // Reload the queue: a reading may have been added while waiting.
    // Only this user's uploaded readings are removed.
    const remaining = loadQueue().filter(function (reading) {
      return !(reading.owner_id === userId && okIds.has(String(reading.id).toLowerCase()));
    });
    saveQueue(remaining);
    return results;
  } finally {
    syncing = false;
    updateConnectionStatus();
  }
}

// Retry in the background (page load and "online" event)
async function retrySync() {
  if (loadQueue().length === 0) return;
  try {
    const results = await syncQueue();
    if (!results) return;
    const uploaded = results.filter(function (item) { return item.ok; }).length;
    const pending = countPendingReadings();
    if (uploaded > 0 && finishMessage.textContent === "") {
      showFinishInfo("Uploaded " + uploaded + " pending reading(s)." +
                     (pending > 0 ? " " + pending + " still pending." : ""));
    }
  } catch (error) {
    // Still offline or server down: readings stay in the queue
    console.warn("Sync retry failed:", error);
  }
}

window.addEventListener("online", retrySync);

// ===== Finish button =====
finishBtn.addEventListener("click", async function () {
  const error = validateCheckin();
  if (error) {
    showFinishError(error);
    return;
  }

  if (!currentProfile) {
    showFinishError("Your profile is still loading. Please try again in a moment.");
    return;
  }

  const reading = buildReading(currentProfile.id);

  // 1) Save first, so nothing is lost if the network fails
  addToQueue(reading);
  clearMeasured(); // the reading is safe in the queue: next check-in starts fresh
  clearForm();

  // 2) Preliminary traffic light computed on the device
  showTrafficLight("Preliminary result", clinicalPreview(reading),
                   "Saved on this device. Uploading...");

  // PANAS is used: the next check-in needs a new one
  sessionStorage.removeItem("panasResult");
  showPanasState();

  // 3) Upload the whole queue
  finishBtn.disabled = true;
  try {
    const results = await syncQueue();
    const mine = (results || []).find(function (item) {
      return String(item.id).toLowerCase() === reading.id.toLowerCase();
    });

    if (mine && mine.ok && mine.analysis) {
      const pending = countPendingReadings();
      showTrafficLight("Result", mine.analysis,
                       pending > 0 ? pending + " older reading(s) still pending." : "Mission log saved.");
    } else if (mine && !mine.ok) {
      showTrafficLight("Preliminary result", clinicalPreview(reading),
                       "Not uploaded yet (" + (mine.error || "unknown error") +
                       "). It will be retried automatically.");
    } else {
      // Another sync was already running; this reading goes in the next one
      showTrafficLight("Preliminary result", clinicalPreview(reading),
                       "Saved on this device. It will be uploaded automatically.");
    }
  } catch (syncError) {
    showTrafficLight("Preliminary result", clinicalPreview(reading),
                     "Offline: saved on this device, it will be uploaded when you are back online. (" +
                     syncError.message + ")");
  } finally {
    finishBtn.disabled = false;
  }
});

connectLogoutButton();  // from supabase_client.js

// ===== On page load =====
// Only signed-in users can check in; then retry any pending readings.
(async function init() {
  const profile = await getProfile();
  if (!profile) {
    window.location.href = "index.html";
    return;
  }
  currentProfile = profile;
  updateConnectionStatus();  // the saved profile may have just changed

  document.getElementById("nombre-usuario").textContent =
    profile.name || profile.astronaut_code || "Astronaut";
  document.getElementById("rol-usuario").textContent =
    [profile.astronaut_code, profile.role].filter(Boolean).join(" · ");

  retrySync();
})();
