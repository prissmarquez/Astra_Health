// ===== ASTRA HEALTH - Sensors page (emulated Bluetooth LE devices) =====
// Each "Send reading" click generates ONE simulated reading, encodes it with the
// official GATT format (ble_codec.js) and sends it ONCE on a BroadcastChannel,
// as a real device would send one notification of its characteristic.
// checkin.html (another tab, same origin) waits for it in Measure and decodes it.
//
// Message: { sensor, uuid, bytes: [numbers 0-255], sent_at: ISO date }
// Needs (loaded before this file): ble_codec.js, supabase_client.js, auth_guard.js.

const BLE_CHANNEL_NAME = "astra_ble";
const BUTTON_COOLDOWN_MS = 1000;  // avoids double clicks
// RR intervals per Heart Rate Measurement packet: 1 flags + 1 HR + 9 x 2 RR = 20 bytes,
// the most that fits one notification with the default BLE ATT MTU (23 - 3 header bytes).
// 9 RR = 8 successive differences, enough for checkin.js to compute RMSSD.
const RR_PER_PACKET = 9;

// Simulated ranges (inside the green zone of backend/ml/health_engine.py).
// Glucose: NASA Inspiration4 pre-flight values.
const SIMULATED_RANGES = {
  heart_rate:         { min: 55,   max: 80 },
  hrv:                { min: 35,   max: 75 },   // target RMSSD of the RR intervals (ms)
  spo2:               { min: 96,   max: 99 },
  temperature:        { min: 36.5, max: 37.2 },
  systolic_pressure:  { min: 105,  max: 125 },
  diastolic_pressure: { min: 65,   max: 80 },
  glucose:            { min: 71,   max: 90 }
};

const bleChannel = "BroadcastChannel" in window ? new BroadcastChannel(BLE_CHANNEL_NAME) : null;

// ----- Simulation helpers -----
function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// Small random walk that stays inside the range (values drift between clicks, they don't jump)
function drift(value, range, step) {
  const next = value + (Math.random() * 2 - 1) * step;
  return Math.min(range.max, Math.max(range.min, next));
}

const round = (v, decimals) => Math.round(v * 10 ** decimals) / 10 ** decimals;

// ----- One emulated device per card -----
// Kept between clicks so consecutive readings look like the same person.
function createState(sensor) {
  const r = SIMULATED_RANGES;
  return {
    sensor,
    heartRate: randomBetween(r.heart_rate.min, r.heart_rate.max),
    rmssdTarget: randomBetween(r.hrv.min, r.hrv.max),  // each RR differs from the previous by ~this
    spo2: randomBetween(r.spo2.min, r.spo2.max),
    temperature: randomBetween(r.temperature.min, r.temperature.max),
    systolic: randomBetween(r.systolic_pressure.min, r.systolic_pressure.max),
    diastolic: randomBetween(r.diastolic_pressure.min, r.diastolic_pressure.max),
    glucose: randomBetween(r.glucose.min, r.glucose.max),
    sequenceNumber: 0
  };
}

// RR intervals (ms) with successive differences of ~rmssdTarget (so RMSSD ~= target);
// the sign is biased back toward the mean RR so the rhythm stays around the heart rate.
function simulateRr(meanRr, rmssdTarget, count) {
  const rr = [];
  let last = meanRr;
  for (let i = 0; i < count; i++) {
    const towardMean = last > meanRr ? -1 : 1;
    const sign = Math.random() < 0.7 ? towardMean : -towardMean;
    last = Math.max(300, Math.min(2000, last + sign * rmssdTarget * randomBetween(0.8, 1.2)));
    rr.push(last);
  }
  return rr;
}

// Builds the next GATT packet and the text shown on the card
function nextPacket(state) {
  const r = SIMULATED_RANGES;
  const now = new Date();

  switch (state.sensor) {
    case "heart_rate":
    case "hrv": {
      // Heart Rate Measurement 0x2A37 with enough RR intervals for HRV in one packet
      state.heartRate = drift(state.heartRate, r.heart_rate, 1.5);
      const hr = Math.round(state.heartRate);
      const rr = simulateRr(60000 / state.heartRate, state.rmssdTarget, RR_PER_PACKET);
      return {
        bytes: BleCodec.encodeHeartRate({ heartRate: hr, rrIntervalsMs: rr }),
        text: state.sensor === "hrv"
          ? rr.length + " RR · RMSSD " + Math.round(BleCodec.computeRmssd(rr)) + " ms"
          : hr + " bpm"
      };
    }
    case "spo2": {
      state.spo2 = drift(state.spo2, r.spo2, 0.4);
      state.heartRate = drift(state.heartRate, r.heart_rate, 1.5);
      const spo2 = Math.round(state.spo2);
      return {
        bytes: BleCodec.encodePlxSpotCheck({ spo2, pulseRate: Math.round(state.heartRate), timestamp: now }),
        text: spo2 + " %"
      };
    }
    case "temperature": {
      state.temperature = drift(state.temperature, r.temperature, 0.05);
      const celsius = round(state.temperature, 1);
      return {
        bytes: BleCodec.encodeTemperature({ celsius, timestamp: now }),
        text: celsius + " °C"
      };
    }
    case "blood_pressure": {
      state.systolic = drift(state.systolic, r.systolic_pressure, 2);
      state.diastolic = drift(state.diastolic, r.diastolic_pressure, 1.5);
      const systolic = Math.round(state.systolic);
      const diastolic = Math.round(state.diastolic);
      return {
        bytes: BleCodec.encodeBloodPressure({ systolic, diastolic, pulseRate: Math.round(state.heartRate), timestamp: now }),
        text: systolic + "/" + diastolic + " mmHg"
      };
    }
    case "glucose": {
      state.glucose = drift(state.glucose, r.glucose, 1);
      const mgdl = Math.round(state.glucose);
      state.sequenceNumber = (state.sequenceNumber + 1) & 0xffff;
      return {
        bytes: BleCodec.encodeGlucose({ mgdl, sequenceNumber: state.sequenceNumber, baseTime: now }),
        text: mgdl + " mg/dL"
      };
    }
    default:
      throw new Error("Unknown sensor: " + state.sensor);
  }
}

// ----- Card UI -----
// Status line under the button (created here so the HTML stays the same)
function statusLine(card) {
  let line = card.querySelector(".sensor-status");
  if (!line) {
    line = document.createElement("small");
    line.className = "sensor-status";
    card.appendChild(line);
  }
  return line;
}

const states = new Map();  // button -> simulation state

// Shared with checkin.html (same origin): { [sensor]: message }
// Keyed by sensor, not by uuid: heart_rate and hrv share 0x2A37 and must not
// overwrite each other.
const LAST_READING_KEY = "astra_ble_last";

function saveLastReading(message) {
  try {
    const all = JSON.parse(localStorage.getItem(LAST_READING_KEY)) || {};
    all[message.sensor] = message;
    localStorage.setItem(LAST_READING_KEY, JSON.stringify(all));
  } catch (error) {
    // Storage blocked: only live delivery works
  }
}

// "Reading sent ✓" / "Reading not sent" notice on the card, removed after ~3 s
const TOAST_MS = 3000;

function showToast(card, text, isError) {
  let toast = card.querySelector(".sensor-toast");
  if (!toast) {
    toast = document.createElement("small");
    toast.className = "sensor-toast";
    toast.setAttribute("role", "status");  // read out by screen readers
    card.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.toggle("error", Boolean(isError));
  clearTimeout(toast.hideTimer);
  toast.hideTimer = setTimeout(function () { toast.remove(); }, TOAST_MS);
}

// Generates one reading and sends it once
function sendReading(button) {
  const card = button.parentElement;
  const status = statusLine(card);
  const sensor = button.dataset.sensor;

  try {
    if (!bleChannel) throw new Error("This browser cannot emulate sensors (no BroadcastChannel).");

    if (!states.has(button)) states.set(button, createState(sensor));
    const packet = nextPacket(states.get(button));
    const sentAt = new Date();

    const message = {
      sensor: sensor,
      uuid: BleCodec.SENSORS[sensor].uuid,
      bytes: Array.from(packet.bytes),
      sent_at: sentAt.toISOString()
    };

    // Live delivery: reaches checkin.html if Measure is already waiting
    bleChannel.postMessage(message);
    // Last reading per sensor: lets Measure pick it up if it is pressed AFTER sending
    saveLastReading(message);

    card.classList.add("connected");
    status.textContent = packet.text + " · sent " +
      sentAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    showToast(card, "Reading sent ✓", false);
  } catch (error) {
    console.error("Reading not sent:", error);
    showToast(card, "Reading not sent", true);
  }
}

document.querySelectorAll(".sensor-btn").forEach(function (button) {
  button.addEventListener("click", function () {
    button.disabled = true;
    sendReading(button);
    setTimeout(function () { button.disabled = false; }, BUTTON_COOLDOWN_MS);
  });
});

window.addEventListener("pagehide", function () {
  if (bleChannel) bleChannel.close();
});

// Only crew members and leaders (auth_guard.js; no session -> index.html), then the header
requireRole(["crew", "leader"]).then(fillUserHeader);
connectLogoutButton();  // from supabase_client.js
