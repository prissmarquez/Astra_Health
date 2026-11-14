from pathlib import Path
import pandas as pd

BASE = Path(__file__).parent
MMASH = BASE / "raw" / "MMASH"
filas = []

for info in sorted(MMASH.rglob("user_info.csv")):
    u = info.parent
    fila = {"usuario": u.name}

    # Frecuencia cardiaca y variabilidad (RR)
    rr = pd.read_csv(u / "RR.csv")
    ibi = rr["ibi_s"][
        (rr["ibi_s"] > 0.3) & (rr["ibi_s"] < 2)
    ]  # quita latidos imposibles
    fila["fc_media_bpm"] = round((60 / ibi).mean(), 1)

    # HRV
    dif = ibi.diff().abs() * 1000
    dif = dif[dif < 200]
    fila["hrv_rmssd_ms"] = round((dif**2).mean() ** 0.5, 1)

    # Sueño
    s = pd.read_csv(u / "sleep.csv")
    if len(s) == 0:
        fila["sueno_total_min"] = None
        fila["sueno_eficiencia_pct"] = None
        fila["despertares"] = None
    else:
        noche = s.loc[s["Total Sleep Time (TST)"].idxmax()]
        fila["sueno_total_min"] = noche["Total Sleep Time (TST)"]
        fila["sueno_eficiencia_pct"] = noche["Efficiency"]
        fila["despertares"] = noche["Number of Awakenings"]

    # Ánimo / estrés
    q = pd.read_csv(u / "questionnaire.csv")
    for col in ["STAI1", "Daily_stress", "PSQI"]:
        if col in q:
            fila[col.lower()] = q[col].iloc[0]
    fila["animo_positivo"] = q.filter(like="pos").iloc[0].mean()
    fila["animo_negativo"] = q.filter(like="neg").iloc[0].mean()

    filas.append(fila)

df = pd.DataFrame(filas)
df.to_csv(BASE / "processed" / "mmash_resumen.csv", index=False)
print(df)
print(df.describe().round(1))
