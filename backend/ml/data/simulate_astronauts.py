from pathlib import Path
import numpy as np
import pandas as pd

BASE = Path(__file__).parent
PROC = BASE / "processed"
rng = np.random.default_rng(42)

# real data
mmash = pd.read_csv(PROC / "mmash_summary.csv")
mmash["total_sleep_min"] = mmash["total_sleep_min"].fillna(
    mmash["total_sleep_min"].median()
)

nasa = pd.read_csv(PROC / "nasa_i4_blood.csv")
nasa = nasa[nasa["timepoint"] != "R+45"]

# glucose fully derived from NASA Inspiration4 (OSD-575) real data
GLU = "glucose_mg_dl"
pre = nasa[nasa["timepoint"].str.startswith("L")]  # pre-flight samples only
GLU_BASES = (
    pre.groupby("SUBJECT_ID")[GLU].mean().dropna().values
)  # real baseline per crew member
GLU_SD = pre.groupby("SUBJECT_ID")[GLU].std().median()  # real pre-flight variation
GLU_LANDING = (
    nasa[nasa["timepoint"] == "R+1"][GLU].mean() - pre[GLU].mean()
)  # real landing spike
print(
    f"Glucose (NASA I4): bases {np.round(GLU_BASES, 1)}, SD {GLU_SD:.1f}, landing spike {GLU_LANDING:+.1f} mg/dL"
)

m = mmash.dropna(subset=["total_sleep_min"])
SLEEP_MOOD_SLOPE = np.polyfit(m["total_sleep_min"], m["negative_mood"], 1)[0]
print(f"Sleep→negative mood relationship (MMASH): {SLEEP_MOOD_SLOPE:.4f} per minute")

# parameters obtained from research and papers
PRE_DAYS = 10
MISSIONS = {  # (flight days, post recovery days)
    "short": (14, 7),  # Inspiration4 / Axiom type
    "standard": (180, 14),  # 6-month ISS expedition
    "long": (365, 21),  # 1-year mission
}
TYPES = ["short"] * 9 + ["standard"] * 10 + ["long"] * 3
ADAPTATION_DAYS = 75  # Stahn 2017
TEMP_CHANGE = 1.0  # Stahn 2017
SYS_CHANGE, DIA_CHANGE = -8, -9  # Norsk 2015
FLIGHT_SLEEP = 360  # Barger 2014
ANOMALY_PROB = 0.07


def phase_and_adaptation(day, flight_days, post_days):
    if day < PRE_DAYS:
        return "pre_flight", 0.0
    if day < PRE_DAYS + flight_days:
        return "flight", min((day - PRE_DAYS) / ADAPTATION_DAYS, 1)
    t = day - PRE_DAYS - flight_days
    at_landing = min(flight_days / ADAPTATION_DAYS, 1)
    return "post_flight", at_landing * max(0, 1 - t / post_days)


rows = []
for i, (_, u) in enumerate(mmash.iterrows()):
    mission = TYPES[i]
    flight_days, post_days = MISSIONS[mission]

    # Baseline for this astronaut
    hr0, hrv0, sleep0 = u["mean_hr_bpm"], u["hrv_rmssd_ms"], u["total_sleep_min"]
    pos0, neg0 = u["positive_mood"], u["negative_mood"]
    glu0 = rng.choice(GLU_BASES)  # CHANGED: real crew baseline
    sys0, dia0 = rng.normal(115, 6), rng.normal(75, 4)
    temp0 = rng.normal(37.0, 0.15)
    spo2_0 = rng.normal(97.5, 0.5)

    for d in range(PRE_DAYS + flight_days + post_days):
        phase, a = phase_and_adaptation(d, flight_days, post_days)
        sleep = rng.normal(sleep0 + (FLIGHT_SLEEP - sleep0) * a, 25)
        row = {
            "astronaut": u["user"],
            "mission": mission,
            "day": d,
            "phase": phase,
            "adaptation": a,
            "heart_rate": rng.normal(hr0, 3),
            "hrv": rng.normal(hrv0, 4),
            "sleep_min": sleep,
            "positive_mood": rng.normal(pos0, 2),
            "negative_mood": rng.normal(neg0 + SLEEP_MOOD_SLOPE * (sleep - sleep0), 2),
            "glucose": rng.normal(glu0, GLU_SD),
            "systolic_pressure": rng.normal(sys0 + SYS_CHANGE * a, 5),
            "diastolic_pressure": rng.normal(dia0 + DIA_CHANGE * a, 4),
            "temperature": rng.normal(temp0 + TEMP_CHANGE * a, 0.2),
            "spo2": np.clip(rng.normal(spo2_0, 0.6), 0, 100),
            "anomaly": 0,
            "anomaly_type": "none",
        }

        # NEW: real landing stress spike on first post-flight day (NASA I4, R+1)
        if d == PRE_DAYS + flight_days:
            row["glucose"] += GLU_LANDING

        # Days with a problem (only in flight)
        if phase == "flight" and rng.random() < ANOMALY_PROB:
            kind = rng.choice(
                ["fever", "hypoxia", "hypertension", "hypoglycemia", "insomnia"]
            )
            if kind == "fever":
                rise = rng.uniform(1.2, 2.0)
                row["temperature"] += rise
                row["heart_rate"] += 10 * rise  # Liebermeister
            elif kind == "hypoxia":
                row["spo2"] = rng.uniform(85, 91)
                row["heart_rate"] += rng.uniform(10, 20)
            elif kind == "hypertension":
                row["systolic_pressure"] = rng.uniform(140, 165)  # ACC/AHA
                row["diastolic_pressure"] = rng.uniform(90, 105)
            elif kind == "hypoglycemia":
                row["glucose"] = rng.uniform(
                    40, 54
                )  # non-diabetic hypoglycemia (Endocrine Society)
            elif kind == "insomnia":
                row["sleep_min"] = rng.uniform(90, 200)
                row["negative_mood"] += 6
                row["hrv"] -= 10
            row["anomaly"], row["anomaly_type"] = 1, kind
        rows.append(row)

df = pd.DataFrame(rows).round(2)
df.to_csv(PROC / "astronaut_dataset_ml.csv", index=False)

print(df.shape)
print(df.groupby("mission")["astronaut"].nunique())
print(
    df.groupby(["mission", "phase"])[
        ["temperature", "systolic_pressure", "sleep_min", "glucose"]
    ]
    .mean()
    .round(1)
)
print(df["anomaly_type"].value_counts())
