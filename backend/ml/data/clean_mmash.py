from pathlib import Path
import pandas as pd

BASE = Path(__file__).parent
MMASH = BASE / "raw" / "MMASH"
rows = []

for info in sorted(MMASH.rglob("user_info.csv")):
    u = info.parent
    row = {"user": u.name}

    # Heart rate and variability (RR)
    rr = pd.read_csv(u / "RR.csv")
    ibi = rr["ibi_s"][
        (rr["ibi_s"] > 0.3) & (rr["ibi_s"] < 2)
    ]  # remove impossible beats
    row["mean_hr_bpm"] = round((60 / ibi).mean(), 1)

    # HRV
    diff = ibi.diff().abs() * 1000
    diff = diff[diff < 200]
    row["hrv_rmssd_ms"] = round((diff**2).mean() ** 0.5, 1)

    # Sleep
    s = pd.read_csv(u / "sleep.csv")
    if len(s) == 0:
        row["total_sleep_min"] = None
        row["sleep_efficiency_pct"] = None
        row["awakenings"] = None
    else:
        night = s.loc[s["Total Sleep Time (TST)"].idxmax()]
        row["total_sleep_min"] = night["Total Sleep Time (TST)"]
        row["sleep_efficiency_pct"] = night["Efficiency"]
        row["awakenings"] = night["Number of Awakenings"]

    # Mood / stress
    q = pd.read_csv(u / "questionnaire.csv")
    for col in ["STAI1", "Daily_stress", "PSQI"]:
        if col in q:
            row[col.lower()] = q[col].iloc[0]
    row["positive_mood"] = q.filter(like="pos").iloc[0].mean()
    row["negative_mood"] = q.filter(like="neg").iloc[0].mean()

    rows.append(row)

df = pd.DataFrame(rows)
df.to_csv(BASE / "processed" / "mmash_summary.csv", index=False)
print(df)
print(df.describe().round(1))
