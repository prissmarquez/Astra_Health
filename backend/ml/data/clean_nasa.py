from pathlib import Path
import pandas as pd

BASE = Path(__file__).parent
RAW, OUT = BASE / "raw", BASE / "processed"

ANALYTES = {
    "GLUCOSE": "glucose_mg_dl",
    "HEMOGLOBIN": "hemoglobin_g_dl",
    "HEMATOCRIT": "hematocrit_pct",
    "RED BLOOD CELL COUNT": "red_blood_cells_m_ul",
}

cbc = pd.read_csv(RAW / "LSDS-7_Complete_Blood_Count_CBC.upload_SUBMITTED.csv").rename(
    columns={"TEST_DATE": "timepoint"}
)
cmp_ = pd.read_csv(
    RAW / "LSDS-8_Comprehensive_Metabolic_Panel_CMP.upload_SUBMITTED.csv"
)
df = pd.concat([cbc, cmp_])

df = df[df["ANALYTE"].isin(ANALYTES)]
df["VALUE"] = pd.to_numeric(df["VALUE"], errors="coerce")

table = df.pivot_table(
    index=["SUBJECT_ID", "SEX", "timepoint"], columns="ANALYTE", values="VALUE"
).reset_index()
table = table.rename(columns=ANALYTES)

# L-92 -> -92, R+1 -> 1
table["day"] = table["timepoint"].str.replace("L", "").str.replace("R", "").astype(int)
table["phase"] = table["day"].apply(lambda d: "pre_flight" if d < 0 else "post_flight")
table = table.sort_values(["SUBJECT_ID", "day"])

table.to_csv(OUT / "nasa_i4_blood.csv", index=False)
print(table)
print(table.groupby("phase")[list(ANALYTES.values())].mean().round(2))
