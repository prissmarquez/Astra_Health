
const BleCodec = (function () {
  "use strict";

  // ---------- UUIDs ----------------------------------------------------------
  // 16-bit SIG UUIDs expand on the Bluetooth Base UUID (Core Spec, Vol 3, Part B, 2.5.1).
  function uuid16ToString(uuid16) {
    return "0000" + uuid16.toString(16).padStart(4, "0") + "-0000-1000-8000-00805f9b34fb";
  }

  // Reserved mantissas: 0x7FF NaN, 0x800 NRes, 0x7FE +INF, 0x802 -INF, 0x801 reserved.
  const SFLOAT = { NAN: 0x07ff, NRES: 0x0800, POS_INF: 0x07fe, NEG_INF: 0x0802, RESERVED: 0x0801 };
  const SFLOAT_MANTISSA_MAX = 2045;  // 0x7FD; 0x7FE-0x802 are special values
  const SFLOAT_EXP_MIN = -8, SFLOAT_EXP_MAX = 7;

  // Builds mantissa * 10^exponent without binary noise (e.g. 368e-1 -> 36.8)
  function fromMantissa(mantissa, exponent) {
    if (exponent >= 0) return mantissa * Math.pow(10, exponent);
    return Number((mantissa / Math.pow(10, -exponent)).toFixed(-exponent));
  }

  // Finds the smallest exponent that keeps `decimals` digits and fits the mantissa
  function toMantissa(value, decimals, mantissaMax, expMin, expMax) {
    let exponent = -decimals;
    let mantissa = Math.round(value * Math.pow(10, decimals));
    while (Math.abs(mantissa) > mantissaMax && exponent < expMax) {
      exponent++;
      mantissa = Math.round(value / Math.pow(10, exponent));
    }
    if (Math.abs(mantissa) > mantissaMax || exponent < expMin || exponent > expMax) {
      throw new RangeError("Value " + value + " does not fit this IEEE-11073 type");
    }
    return { mantissa, exponent };
  }

  // value: number; decimals: digits to keep after the point. Returns a uint16.
  function encodeSfloat(value, decimals) {
    if (Number.isNaN(value)) return SFLOAT.NAN;
    if (value === Infinity) return SFLOAT.POS_INF;
    if (value === -Infinity) return SFLOAT.NEG_INF;
    const { mantissa, exponent } = toMantissa(value, decimals || 0, SFLOAT_MANTISSA_MAX,
                                              SFLOAT_EXP_MIN, SFLOAT_EXP_MAX);
    return ((exponent & 0x0f) << 12) | (mantissa & 0x0fff);
  }

  // raw: uint16. Returns a number (NaN for NaN / NRes / reserved).
  function decodeSfloat(raw) {
    raw &= 0xffff;
    const m = raw & 0x0fff;
    if (m === SFLOAT.POS_INF) return Infinity;
    if (m === SFLOAT.NEG_INF) return -Infinity;
    if (m === SFLOAT.NAN || m === SFLOAT.NRES || m === SFLOAT.RESERVED) return NaN;
    const mantissa = m >= 0x0800 ? m - 0x1000 : m;
    let exponent = raw >> 12;
    if (exponent >= 8) exponent -= 16;
    return fromMantissa(mantissa, exponent);
  }

  
  // 8-bit signed exponent (high byte) + 24-bit signed mantissa.
  // Reserved mantissas: 0x7FFFFF NaN, 0x800000 NRes, 0x7FFFFE +INF, 0x800002 -INF, 0x800001 reserved.
  const FLOAT = { NAN: 0x007fffff, NRES: 0x00800000, POS_INF: 0x007ffffe, NEG_INF: 0x00800002, RESERVED: 0x00800001 };
  const FLOAT_MANTISSA_MAX = 8388605;  // 0x7FFFFD

  function encodeFloat(value, decimals) {
    if (Number.isNaN(value)) return FLOAT.NAN;
    if (value === Infinity) return FLOAT.POS_INF;
    if (value === -Infinity) return FLOAT.NEG_INF;
    const { mantissa, exponent } = toMantissa(value, decimals || 0, FLOAT_MANTISSA_MAX, -128, 127);
    return (((exponent & 0xff) << 24) | (mantissa & 0x00ffffff)) >>> 0;
  }

  function decodeFloat(raw) {
    raw >>>= 0;
    const m = raw & 0x00ffffff;
    if (m === FLOAT.POS_INF) return Infinity;
    if (m === FLOAT.NEG_INF) return -Infinity;
    if (m === FLOAT.NAN || m === FLOAT.NRES || m === FLOAT.RESERVED) return NaN;
    const mantissa = m >= 0x800000 ? m - 0x1000000 : m;
    let exponent = raw >>> 24;
    if (exponent >= 128) exponent -= 256;
    return fromMantissa(mantissa, exponent);
  }

  

  // Accepts a DataView (Web Bluetooth), ArrayBuffer, Uint8Array or array of bytes.
  function toDataView(input) {
    if (input instanceof DataView) return input;
    if (input instanceof ArrayBuffer) return new DataView(input);
    if (ArrayBuffer.isView(input)) return new DataView(input.buffer, input.byteOffset, input.byteLength);
    if (Array.isArray(input)) {
      if (!input.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
        throw new TypeError("Bytes must be integers from 0 to 255");
      }
      return new DataView(Uint8Array.from(input).buffer);
    }
    throw new TypeError("Unsupported packet type");
  }

  class ByteReader {
    constructor(input) { this.view = toDataView(input); this.offset = 0; }
    need(n) {
      if (this.offset + n > this.view.byteLength) throw new RangeError("Packet too short");
    }
    remaining() { return this.view.byteLength - this.offset; }
    u8() { this.need(1); return this.view.getUint8(this.offset++); }
    u16() { this.need(2); const v = this.view.getUint16(this.offset, true); this.offset += 2; return v; }
    s16() { this.need(2); const v = this.view.getInt16(this.offset, true); this.offset += 2; return v; }
    u24() { return this.u16() | (this.u8() << 16); }
    u32() { this.need(4); const v = this.view.getUint32(this.offset, true); this.offset += 4; return v; }
    sfloat() { return decodeSfloat(this.u16()); }
    float() { return decodeFloat(this.u32()); }
    // Date Time (GSS, 0x2A08): year uint16, month, day, hours, minutes, seconds (uint8). UTC here.
    dateTime() {
      const year = this.u16(), month = this.u8(), day = this.u8();
      const h = this.u8(), min = this.u8(), s = this.u8();
      if (year === 0 || month === 0 || day === 0) return null;  // 0 = "not known"
      return new Date(Date.UTC(year, month - 1, day, h, min, s));
    }
  }

  class ByteWriter {
    constructor() { this.bytes = []; }
    u8(v) { this.bytes.push(v & 0xff); return this; }
    u16(v) { return this.u8(v).u8(v >> 8); }
    s16(v) { return this.u16(v & 0xffff); }
    u32(v) { return this.u16(v & 0xffff).u16((v >>> 16) & 0xffff); }
    sfloat(value, decimals) { return this.u16(encodeSfloat(value, decimals)); }
    float(value, decimals) { return this.u32(encodeFloat(value, decimals)); }
    dateTime(date) {
      return this.u16(date.getUTCFullYear()).u8(date.getUTCMonth() + 1).u8(date.getUTCDate())
        .u8(date.getUTCHours()).u8(date.getUTCMinutes()).u8(date.getUTCSeconds());
    }
    toUint8Array() { return Uint8Array.from(this.bytes); }
  }

 
  function encodeHeartRate({ heartRate, rrIntervalsMs = [], energyExpended = null, sensorContact = true }) {
    const wide = heartRate > 255;
    let flags = wide ? 0x01 : 0x00;
    flags |= (sensorContact ? 3 : 2) << 1;
    if (energyExpended != null) flags |= 0x08;
    if (rrIntervalsMs.length) flags |= 0x10;

    const w = new ByteWriter().u8(flags);
    if (wide) w.u16(Math.round(heartRate)); else w.u8(Math.round(heartRate));
    if (energyExpended != null) w.u16(energyExpended);
    for (const ms of rrIntervalsMs) {
      w.u16(Math.min(0xffff, Math.max(0, Math.round((ms * 1024) / 1000))));  // ms -> 1/1024 s
    }
    return w.toUint8Array();
  }

  function decodeHeartRate(input) {
    const r = new ByteReader(input);
    const flags = r.u8();
    const heartRate = flags & 0x01 ? r.u16() : r.u8();
    const contactBits = (flags >> 1) & 0x03;
    const energyExpended = flags & 0x08 ? r.u16() : null;
    const rrIntervals1024 = [];
    if (flags & 0x10) {
      while (r.remaining() >= 2) rrIntervals1024.push(r.u16());
    }
    return {
      heartRate,
      sensorContact: contactBits === 3 ? true : contactBits === 2 ? false : null,  // null = not supported
      energyExpended,
      rrIntervals1024,
      rrIntervalsMs: rrIntervals1024.map((u) => Math.round(((u * 1000) / 1024) * 10) / 10),
    };
  }

 
  function encodePlxSpotCheck({ spo2, pulseRate, timestamp = null }) {
    const w = new ByteWriter().u8(timestamp ? 0x01 : 0x00);
    w.sfloat(spo2, 0).sfloat(pulseRate, 0);
    if (timestamp) w.dateTime(timestamp);
    return w.toUint8Array();
  }

  function decodePlxSpotCheck(input) {
    const r = new ByteReader(input);
    const flags = r.u8();
    const result = { spo2: r.sfloat(), pulseRate: r.sfloat() };
    result.timestamp = flags & 0x01 ? r.dateTime() : null;
    result.measurementStatus = flags & 0x02 ? r.u16() : null;
    result.deviceSensorStatus = flags & 0x04 ? r.u24() : null;
    result.pulseAmplitudeIndex = flags & 0x08 ? r.sfloat() : null;
    result.clockNotSet = Boolean(flags & 0x10);
    return result;
  }


  function encodeTemperature({ celsius, timestamp = null, type = 2 }) {
    let flags = 0x00;  // Celsius
    if (timestamp) flags |= 0x02;
    if (type != null) flags |= 0x04;
    const w = new ByteWriter().u8(flags).float(celsius, 2);
    if (timestamp) w.dateTime(timestamp);
    if (type != null) w.u8(type);
    return w.toUint8Array();
  }

  function decodeTemperature(input) {
    const r = new ByteReader(input);
    const flags = r.u8();
    const raw = r.float();
    const fahrenheit = Boolean(flags & 0x01);
    return {
      celsius: fahrenheit ? Math.round(((raw - 32) * 5 / 9) * 100) / 100 : raw,
      unitsReceived: fahrenheit ? "F" : "C",
      timestamp: flags & 0x02 ? r.dateTime() : null,
      type: flags & 0x04 ? r.u8() : null,
    };
  }


  const KPA_TO_MMHG = 7.500617;

  function encodeBloodPressure({ systolic, diastolic, meanArterial = null, pulseRate = null, timestamp = null }) {
    const map = meanArterial != null ? meanArterial
      : Math.round((diastolic + (systolic - diastolic) / 3) * 10) / 10;
    let flags = 0x00;  // mmHg
    if (timestamp) flags |= 0x02;
    if (pulseRate != null) flags |= 0x04;
    const w = new ByteWriter().u8(flags).sfloat(systolic, 0).sfloat(diastolic, 0).sfloat(map, 1);
    if (timestamp) w.dateTime(timestamp);
    if (pulseRate != null) w.sfloat(pulseRate, 0);
    return w.toUint8Array();
  }

  function decodeBloodPressure(input) {
    const r = new ByteReader(input);
    const flags = r.u8();
    const kpa = Boolean(flags & 0x01);
    const toMmHg = (v) => (kpa ? Math.round(v * KPA_TO_MMHG * 10) / 10 : v);
    const result = {
      systolic: toMmHg(r.sfloat()),
      diastolic: toMmHg(r.sfloat()),
      meanArterial: toMmHg(r.sfloat()),
      unitsReceived: kpa ? "kPa" : "mmHg",
    };
    result.timestamp = flags & 0x02 ? r.dateTime() : null;
    result.pulseRate = flags & 0x04 ? r.sfloat() : null;
    result.userId = flags & 0x08 ? r.u8() : null;
    result.measurementStatus = flags & 0x10 ? r.u16() : null;
    return result;
  }


  const MGDL_PER_MMOL = 18.0156;

  function encodeGlucose({ mgdl, sequenceNumber = 0, baseTime = new Date(), units = "kg/L",
                           type = 0x9, sampleLocation = 0xf }) {
    const molar = units === "mol/L";
    const flags = 0x02 | (molar ? 0x04 : 0x00);
    const w = new ByteWriter().u8(flags).u16(sequenceNumber).dateTime(baseTime);
    if (molar) w.sfloat(mgdl / MGDL_PER_MMOL / 1000, 6);  // mol/L, 1e-6 resolution
    else w.sfloat(mgdl / 100000, 5);                      // kg/L, 1 mg/dL resolution
    w.u8(((sampleLocation & 0x0f) << 4) | (type & 0x0f));
    return w.toUint8Array();
  }

  function decodeGlucose(input) {
    const r = new ByteReader(input);
    const flags = r.u8();
    const result = { sequenceNumber: r.u16(), baseTime: r.dateTime() };
    result.timeOffsetMin = flags & 0x01 ? r.s16() : null;
    result.mgdl = null;
    if (flags & 0x02) {
      const raw = r.sfloat();
      const molar = Boolean(flags & 0x04);
      const mgdl = molar ? raw * 1000 * MGDL_PER_MMOL : raw * 100000;
      result.mgdl = Math.round(mgdl * 10) / 10;
      result.unitsReceived = molar ? "mol/L" : "kg/L";
      const typeLocation = r.u8();
      result.type = typeLocation & 0x0f;
      result.sampleLocation = typeLocation >> 4;
    }
    result.sensorStatus = flags & 0x08 ? r.u16() : null;
    result.contextFollows = Boolean(flags & 0x10);
    return result;
  }

  // RMSSD: root mean square of successive RR differences (Task Force of the ESC/NASPE,
  // Circulation 1996). rrIntervalsMs: RR intervals in ms, in order. Returns ms or null.
  function computeRmssd(rrIntervalsMs) {
    const rr = (rrIntervalsMs || []).filter((v) => Number.isFinite(v) && v > 0);
    if (rr.length < 2) return null;
    let sum = 0;
    for (let i = 1; i < rr.length; i++) sum += (rr[i] - rr[i - 1]) ** 2;
    return Math.round(Math.sqrt(sum / (rr.length - 1)) * 10) / 10;
  }

 
  // toIndicators(decoded) -> { indicator: value } with the names of OfflineReading.
  // hrv has no characteristic of its own: it is computed from the RR intervals of 0x2A37.
  const SENSORS = {
    heart_rate: {
      service: 0x180d, characteristic: 0x2a37, name: "Heart Rate Measurement",
      indicators: ["heart_rate"], encode: encodeHeartRate, decode: decodeHeartRate,
      toIndicators: (d) => ({ heart_rate: d.heartRate }),
    },
    hrv: {
      service: 0x180d, characteristic: 0x2a37, name: "Heart Rate Measurement (RR -> RMSSD)",
      indicators: ["hrv"], encode: encodeHeartRate, decode: decodeHeartRate,
      toIndicators: () => ({}),  // needs several packets: see computeRmssd()
    },
    spo2: {
      service: 0x1822, characteristic: 0x2a5e, name: "PLX Spot-Check Measurement",
      indicators: ["spo2"], encode: encodePlxSpotCheck, decode: decodePlxSpotCheck,
      toIndicators: (d) => ({ spo2: d.spo2 }),
    },
    temperature: {
      service: 0x1809, characteristic: 0x2a1c, name: "Temperature Measurement",
      indicators: ["temperature"], encode: encodeTemperature, decode: decodeTemperature,
      toIndicators: (d) => ({ temperature: d.celsius }),
    },
    blood_pressure: {
      service: 0x1810, characteristic: 0x2a35, name: "Blood Pressure Measurement",
      indicators: ["systolic_pressure", "diastolic_pressure"],
      encode: encodeBloodPressure, decode: decodeBloodPressure,
      toIndicators: (d) => ({ systolic_pressure: d.systolic, diastolic_pressure: d.diastolic }),
    },
    glucose: {
      service: 0x1808, characteristic: 0x2a18, name: "Glucose Measurement",
      indicators: ["glucose"], encode: encodeGlucose, decode: decodeGlucose,
      toIndicators: (d) => ({ glucose: d.mgdl }),
    },
  };
  for (const key of Object.keys(SENSORS)) {
    SENSORS[key].uuid = uuid16ToString(SENSORS[key].characteristic);
    SENSORS[key].serviceUuid = uuid16ToString(SENSORS[key].service);
  }

  // indicator -> sensor key, e.g. systolic_pressure -> "blood_pressure"
  const INDICATOR_TO_SENSOR = {};
  for (const [key, s] of Object.entries(SENSORS)) {
    for (const indicator of s.indicators) INDICATOR_TO_SENSOR[indicator] = key;
  }

  return Object.freeze({
    SENSORS, INDICATOR_TO_SENSOR, uuid16ToString, toDataView,
    encodeSfloat, decodeSfloat, encodeFloat, decodeFloat,
    encodeHeartRate, decodeHeartRate,
    encodePlxSpotCheck, decodePlxSpotCheck,
    encodeTemperature, decodeTemperature,
    encodeBloodPressure, decodeBloodPressure,
    encodeGlucose, decodeGlucose,
    computeRmssd,
  });
})();

if (typeof module !== "undefined" && module.exports) module.exports = BleCodec;
