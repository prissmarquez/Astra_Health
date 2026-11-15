from pathlib import Path
from datetime import datetime
import pandas as pd
import joblib
from sklearn.ensemble import IsolationForest
from sklearn.metrics import classification_report, confusion_matrix
from health_engine import IND, ZCOLS, TRAFFIC_LIGHT, clinical, compute_z, explain, analyze

BASE = Path(__file__).parent
PROC = BASE / "data" / "processed"

#  1. Data: simulated + real (if they already exist)
df = pd.read_csv(PROC / "astronaut_dataset_ml.csv")
real = PROC / "real_data.csv"
if real.exists():
    df = pd.concat([df, pd.read_csv(real)], ignore_index=True)
    print(f"Including {len(pd.read_csv(real))} rows of real data")
df["anomaly"] = df["anomaly"].fillna(0)
df = compute_z(df)

#  2. Train on normal days
model = IsolationForest(n_estimators=200, contamination=0.05, random_state=42)
model.fit(df[df["anomaly"] == 0][ZCOLS])

#  3. Evaluate the 3 layers
cli = df.apply(clinical, axis=1)
df["clinical_level"] = [x[0] for x in cli]
zmax = df[ZCOLS].abs().max(axis=1)
df["personal_level"] = (zmax > 2).astype(int) + (zmax > 3).astype(int)
df["ml_anomaly"] = (model.predict(df[ZCOLS]) == -1).astype(int)
df["final_level"] = df[["clinical_level", "personal_level", "ml_anomaly"]].max(axis=1)
df["traffic_light"] = df["final_level"].map(TRAFFIC_LIGHT)

print("\n--- Connections learned from the data (correlation of deviations) ---")
corr = df[df["anomaly"] == 0][ZCOLS].corr()
pairs = corr.where(lambda m: m.abs() < 1).stack().abs().sort_values(ascending=False)
print(pairs.drop_duplicates().head(6).round(2))

print("\n--- Does it detect the problem days? ---")
pred = (df["final_level"] >= 1).astype(int)
print(confusion_matrix(df["anomaly"], pred))
print(classification_report(df["anomaly"], pred, target_names=["normal", "anomaly"]))

print("--- Detection by type ---")
print(
    df[df["anomaly"] == 1]
    .groupby("anomaly_type")["final_level"]
    .apply(lambda s: (s >= 1).mean())
    .round(2)
)

print("\n--- Traffic light by mission and phase ---")
print(pd.crosstab([df["mission"], df["phase"]], df["traffic_light"]))

#  4. Save
df.to_csv(PROC / "ml_results.csv", index=False)
joblib.dump(
    {
        "model": model,
        "zcols": ZCOLS,
        "trained": datetime.now().isoformat(),
        "rows": len(df),
    },
    BASE / "isolation_forest_model.pkl",
)
print("\n Model saved to isolation_forest_model.pkl")

#  5. Demo: a new reading with fever
package = joblib.load(BASE / "isolation_forest_model.pkl")
history = pd.read_csv(PROC / "astronaut_dataset_ml.csv")
history = history[(history["astronaut"] == "user_1") & (history["day"] < 20)]
reading = history.iloc[-1][
    ["astronaut", "mission", "phase", "adaptation"] + IND
].to_dict()
reading["day"] = 20
reading["temperature"] += 1.6
reading["heart_rate"] += 16
print("\n--- Demo: new reading with fever ---")
print(analyze(history, reading, package))
