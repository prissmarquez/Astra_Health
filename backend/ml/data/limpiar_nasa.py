from pathlib import Path
import pandas as pd

BASE = Path(__file__).parent
RAW, OUT = BASE / "raw", BASE / "processed"

ANALITOS = {
    "GLUCOSE": "glucosa_mg_dl",
    "HEMOGLOBIN": "hemoglobina_g_dl",
    "HEMATOCRIT": "hematocrito_pct",
    "RED BLOOD CELL COUNT": "globulos_rojos_m_ul",
}

cbc = pd.read_csv(RAW / "LSDS-7_Complete_Blood_Count_CBC.upload_SUBMITTED.csv").rename(
    columns={"TEST_DATE": "timepoint"}
)
cmp_ = pd.read_csv(
    RAW / "LSDS-8_Comprehensive_Metabolic_Panel_CMP.upload_SUBMITTED.csv"
)
df = pd.concat([cbc, cmp_])

df = df[df["ANALYTE"].isin(ANALITOS)]
df["VALUE"] = pd.to_numeric(df["VALUE"], errors="coerce")

tabla = df.pivot_table(
    index=["SUBJECT_ID", "SEX", "timepoint"], columns="ANALYTE", values="VALUE"
).reset_index()
tabla = tabla.rename(columns=ANALITOS)

# L-92 -> -92, R+1 -> 1
tabla["dia"] = tabla["timepoint"].str.replace("L", "").str.replace("R", "").astype(int)
tabla["fase"] = tabla["dia"].apply(lambda d: "pre_vuelo" if d < 0 else "post_vuelo")
tabla = tabla.sort_values(["SUBJECT_ID", "dia"])

tabla.to_csv(OUT / "nasa_i4_sangre.csv", index=False)
print(tabla)
print(tabla.groupby("fase")[list(ANALITOS.values())].mean().round(2))
