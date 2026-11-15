import pandas as pd

IND = [
    "heart_rate",
    "hrv",
    "sleep_min",
    "positive_mood",
    "negative_mood",
    "glucose",
    "systolic_pressure",
    "diastolic_pressure",
    "temperature",
    "spo2",
]
ZCOLS = ["z_" + c for c in IND]
NAMES = {
    "heart_rate": "HR",
    "hrv": "HRV",
    "sleep_min": "sleep",
    "positive_mood": "positive mood",
    "negative_mood": "negative mood",
    "glucose": "glucose",
    "systolic_pressure": "systolic pressure",
    "diastolic_pressure": "diastolic pressure",
    "temperature": "temperature",
    "spo2": "SpO2",
}
CONNECTIONS = {
    frozenset(["temperature", "heart_rate"]): "fever speeds up the heart",
    frozenset(
        ["spo2", "heart_rate"]
    ): "with low oxygen the heart beats faster to compensate",
    frozenset(["sleep_min", "negative_mood"]): "sleeping little worsens mood",
    frozenset(
        ["sleep_min", "hrv"]
    ): "sleeping little reduces heart rate variability (more stress)",
    frozenset(
        ["systolic_pressure", "diastolic_pressure"]
    ): "both pressures moved together",
}
WINDOW, MIN_DAYS = 14, 5
TRAFFIC_LIGHT = {0: "green", 1: "yellow", 2: "red"}


def clinical(r):
    "Layer 1: clinical thresholds. Temperature and low pressure are adjusted for adaptation."
    level, reasons = 0, []
    a = r.get("adaptation", 0) or 0
    expected_temp = 37.0 + 1.0 * a
    expected_sys = 115 - 8 * a

    def flag(red, yellow, text):
        nonlocal level
        if red:
            level = 2
            reasons.append(text)
        elif yellow:
            level = max(level, 1)
            reasons.append(text)

    flag(r["spo2"] < 92, r["spo2"] < 95, "low SpO2")
    flag(
        r["temperature"] >= expected_temp + 2.0,
        r["temperature"] >= expected_temp + 1.5,
        "high temperature",
    )
    flag(
        r["systolic_pressure"] >= 140 or r["diastolic_pressure"] >= 90,
        r["systolic_pressure"] >= 130 or r["diastolic_pressure"] >= 80,
        "high pressure",
    )
    flag(
        r["systolic_pressure"] < expected_sys - 30,
        r["systolic_pressure"] < expected_sys - 25,
        "low pressure",
    )
    flag(
        r["glucose"] < 54 or r["glucose"] > 250,
        r["glucose"] < 70 or r["glucose"] > 180,
        "glucose out of range",
    )
    flag(
        r["heart_rate"] > 120 or r["heart_rate"] < 40,
        r["heart_rate"] > 100 or r["heart_rate"] < 50,
        "HR out of range",
    )
    flag(r["sleep_min"] < 150, r["sleep_min"] < 210, "insufficient sleep")
    return level, reasons


def compute_z(df):
    "Layer 2: deviation of each value against the same astronaut's last 14 days."
    df = df.sort_values(["astronaut", "day"]).reset_index(drop=True)
    g = df.groupby("astronaut")
    for c in IND:
        mean = g[c].transform(
            lambda s: s.shift(1).rolling(WINDOW, min_periods=MIN_DAYS).mean()
        )
        sd = g[c].transform(
            lambda s: s.shift(1).rolling(WINDOW, min_periods=MIN_DAYS).std()
        )
        df["z_" + c] = ((df[c] - mean) / sd).fillna(0).clip(-10, 10)
    return df


def explain(r):
    dev = sorted(
        [c for c in IND if abs(r["z_" + c]) > 2], key=lambda c: -abs(r["z_" + c])
    )
    parts = [
        f"{NAMES[c]} {'↑' if r['z_' + c] > 0 else '↓'} ({r['z_' + c]:+.1f}σ)"
        for c in dev[:3]
    ]
    connections = [
        CONNECTIONS[frozenset([x, y])]
        for i, x in enumerate(dev)
        for y in dev[i + 1 :]
        if frozenset([x, y]) in CONNECTIONS
    ]
    return parts, connections


def analyze(history, reading, package):
    "What the API will call with each new reading."
    df = pd.concat([history, pd.DataFrame([reading])], ignore_index=True)
    df = compute_z(df)
    r = df[
        (df["astronaut"] == reading["astronaut"]) & (df["day"] == reading["day"])
    ].iloc[-1]

    n_cli, reasons = clinical(r)
    previous_days = len(history[history["astronaut"] == reading["astronaut"]])
    if previous_days >= MIN_DAYS:
        mode = "personal"
        zmax = r[ZCOLS].abs().max()
        n_per = int(zmax > 2) + int(zmax > 3)
        n_ml = int(
            package["model"].predict(pd.DataFrame([r[ZCOLS].astype(float)]))[0] == -1
        )
    else:
        mode = "startup (few days of history, clinical thresholds only)"
        n_per = n_ml = 0

    level = max(n_cli, n_per, n_ml)
    parts, connections = explain(r)
    return {
        "traffic_light": TRAFFIC_LIGHT[level],
        "mode": mode,
        "clinical_reasons": reasons,
        "deviations": parts,
        "connections": connections,
        "detected_by_ml": bool(n_ml),
    }
