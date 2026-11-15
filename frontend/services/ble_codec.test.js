// Tests for ble_codec.js. Run from the repo root:
//   node frontend/ble_codec.test.js
// 1) Round trip: encode -> decode returns the same values.
// 2) Known bytes: the encoded packet matches the GATT layout byte by byte
//    (catches wrong flags or byte order that a round trip would not).

const assert = require("node:assert/strict");
const B = require("./ble_codec.js");

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("  ok  " + name);
  } catch (error) {
    console.error("  FAIL " + name + "\n       " + error.message);
    process.exitCode = 1;
  }
}
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join(" ");
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} != ${expected} ± ${tolerance}`);

const FIXED_TIME = new Date(Date.UTC(2026, 10, 15, 6, 30, 5));  // 2026-11-15 06:30:05 UTC

console.log("IEEE-11073 SFLOAT / FLOAT");
test("SFLOAT round trip", () => {
  for (const [v, d] of [[0, 0], [98, 0], [-12, 0], [36.8, 1], [120.5, 1], [0.00085, 5], [2045, 0], [12000, 0]]) {
    assert.equal(B.decodeSfloat(B.encodeSfloat(v, d)), v, `value ${v}`);
  }
});
test("SFLOAT known bytes: 98 -> 0x0062, 36.8 -> 0xF170", () => {
  assert.equal(B.encodeSfloat(98, 0), 0x0062);
  assert.equal(B.encodeSfloat(36.8, 1), 0xf170);  // exponent -1 (0xF), mantissa 368 (0x170)
});
test("SFLOAT special values", () => {
  assert.ok(Number.isNaN(B.decodeSfloat(0x07ff)));
  assert.ok(Number.isNaN(B.decodeSfloat(0x0800)));  // NRes
  assert.equal(B.decodeSfloat(0x07fe), Infinity);
  assert.equal(B.decodeSfloat(0x0802), -Infinity);
});
test("FLOAT round trip", () => {
  for (const [v, d] of [[36.8, 2], [37.05, 2], [-40, 0], [98.6, 1], [123456.7, 1]]) {
    assert.equal(B.decodeFloat(B.encodeFloat(v, d)), v, `value ${v}`);
  }
});
test("FLOAT known bytes: 36.8 (1 decimal) -> 0xFF000170", () => {
  assert.equal(B.encodeFloat(36.8, 1), 0xff000170);
});

console.log("Heart Rate Measurement 0x2A37");
test("round trip with RR intervals", () => {
  const rr = [812, 790.5, 845];
  const d = B.decodeHeartRate(B.encodeHeartRate({ heartRate: 72, rrIntervalsMs: rr }));
  assert.equal(d.heartRate, 72);
  assert.equal(d.sensorContact, true);
  rr.forEach((ms, i) => near(d.rrIntervalsMs[i], ms, 1, "RR " + i));  // 1/1024 s resolution
});
test("known bytes: HR 72, RR 1000 ms", () => {
  // flags 0x16 = RR present (0x10) + contact detected (0x06); HR uint8; RR 1024/1024 s = 0x0400 LE
  assert.equal(hex(B.encodeHeartRate({ heartRate: 72, rrIntervalsMs: [1000] })), "16 48 00 04");
});
test("uint16 format above 255 bpm", () => {
  const bytes = B.encodeHeartRate({ heartRate: 300 });
  assert.equal(bytes[0] & 0x01, 1);
  assert.equal(B.decodeHeartRate(bytes).heartRate, 300);
});
test("decodes energy expended", () => {
  const d = B.decodeHeartRate(B.encodeHeartRate({ heartRate: 80, energyExpended: 512, rrIntervalsMs: [750] }));
  assert.equal(d.energyExpended, 512);
  near(d.rrIntervalsMs[0], 750, 1, "RR");
});
test("decodes a Web Bluetooth DataView", () => {
  const u8 = B.encodeHeartRate({ heartRate: 64 });
  assert.equal(B.decodeHeartRate(new DataView(u8.buffer)).heartRate, 64);
});

console.log("PLX Spot-Check Measurement 0x2A5E");
test("round trip", () => {
  const d = B.decodePlxSpotCheck(B.encodePlxSpotCheck({ spo2: 97, pulseRate: 68 }));
  assert.equal(d.spo2, 97);
  assert.equal(d.pulseRate, 68);
  assert.equal(d.timestamp, null);
});
test("known bytes: SpO2 97, PR 68", () => {
  assert.equal(hex(B.encodePlxSpotCheck({ spo2: 97, pulseRate: 68 })), "00 61 00 44 00");
});
test("round trip with timestamp", () => {
  const d = B.decodePlxSpotCheck(B.encodePlxSpotCheck({ spo2: 99, pulseRate: 55, timestamp: FIXED_TIME }));
  assert.equal(d.timestamp.toISOString(), FIXED_TIME.toISOString());
});

console.log("Temperature Measurement 0x2A1C");
test("round trip Celsius + type", () => {
  const d = B.decodeTemperature(B.encodeTemperature({ celsius: 36.8, timestamp: FIXED_TIME }));
  assert.equal(d.celsius, 36.8);
  assert.equal(d.unitsReceived, "C");
  assert.equal(d.type, 2);
  assert.equal(d.timestamp.toISOString(), FIXED_TIME.toISOString());
});
test("Fahrenheit packet is converted to Celsius", () => {
  // flags 0x01 (Fahrenheit), FLOAT 98.6 = mantissa 986, exponent -1
  const d = B.decodeTemperature([0x01, 0xda, 0x03, 0x00, 0xff]);
  near(d.celsius, 37, 0.01, "celsius");
  assert.equal(d.unitsReceived, "F");
});

console.log("Blood Pressure Measurement 0x2A35");
test("round trip mmHg + pulse rate", () => {
  const d = B.decodeBloodPressure(B.encodeBloodPressure({ systolic: 118, diastolic: 76, pulseRate: 66 }));
  assert.equal(d.systolic, 118);
  assert.equal(d.diastolic, 76);
  assert.equal(d.meanArterial, 90);
  assert.equal(d.pulseRate, 66);
  assert.equal(d.unitsReceived, "mmHg");
});
test("known bytes: 120/80, MAP 93.3", () => {
  // flags 0x00 · 120 = 0x0078 · 80 = 0x0050 · 93.3 = mantissa 933 (0x3A5), exponent -1 -> 0xF3A5
  assert.equal(hex(B.encodeBloodPressure({ systolic: 120, diastolic: 80 })), "00 78 00 50 00 a5 f3");
});
test("kPa packet is converted to mmHg", () => {
  // 16.0 / 10.7 / 12.4 kPa (mantissa x10, exponent -1)
  const d = B.decodeBloodPressure([0x01, 0xa0, 0xf0, 0x6b, 0xf0, 0x7c, 0xf0]);
  near(d.systolic, 120, 0.1, "systolic");
  near(d.diastolic, 80.3, 0.1, "diastolic");
});

console.log("Glucose Measurement 0x2A18");
test("round trip kg/L", () => {
  const d = B.decodeGlucose(B.encodeGlucose({ mgdl: 85, sequenceNumber: 7, baseTime: FIXED_TIME }));
  assert.equal(d.mgdl, 85);
  assert.equal(d.sequenceNumber, 7);
  assert.equal(d.baseTime.toISOString(), FIXED_TIME.toISOString());
  assert.equal(d.type, 0x9);
  assert.equal(d.sampleLocation, 0xf);
});
test("known bytes: 85 mg/dL in kg/L", () => {
  // flags 0x02 · seq 1 · 2026-11-15 06:30:05 · 85e-5 kg/L = mantissa 85, exponent -5 (0xB) -> 0xB055 · 0xF9
  assert.equal(hex(B.encodeGlucose({ mgdl: 85, sequenceNumber: 1, baseTime: FIXED_TIME })),
               "02 01 00 ea 07 0b 0f 06 1e 05 55 b0 f9");
});
test("round trip mol/L", () => {
  const d = B.decodeGlucose(B.encodeGlucose({ mgdl: 85, units: "mol/L", baseTime: FIXED_TIME }));
  near(d.mgdl, 85, 0.5, "mg/dL");  // 4.72 mmol/L resolution
  assert.equal(d.unitsReceived, "mol/L");
});

console.log("HRV and sensor table");
test("computeRmssd", () => {
  assert.equal(B.computeRmssd([800, 810, 790, 820]), 21.6);  // sqrt((100 + 400 + 900) / 3)
  assert.equal(B.computeRmssd([800]), null);
});
test("every sensor round-trips through its own codec", () => {
  const samples = {
    heart_rate: { heartRate: 70, rrIntervalsMs: [857] },
    hrv: { heartRate: 70, rrIntervalsMs: [857, 870] },
    spo2: { spo2: 98, pulseRate: 70 },
    temperature: { celsius: 36.9 },
    blood_pressure: { systolic: 115, diastolic: 75 },
    glucose: { mgdl: 80, baseTime: FIXED_TIME },
  };
  for (const [key, sensor] of Object.entries(B.SENSORS)) {
    const decoded = sensor.decode(sensor.encode(samples[key]));
    assert.ok(decoded, key);
    assert.match(sensor.uuid, /^0000[0-9a-f]{4}-0000-1000-8000-00805f9b34fb$/);
  }
  assert.equal(B.INDICATOR_TO_SENSOR.diastolic_pressure, "blood_pressure");
  assert.equal(B.SENSORS.blood_pressure.uuid, "00002a35-0000-1000-8000-00805f9b34fb");
});
test("short packet throws", () => {
  assert.throws(() => B.decodeBloodPressure([0x00, 0x78]), RangeError);
});

console.log(`\n${passed} passed` + (process.exitCode ? ", some FAILED" : ", all good"));
