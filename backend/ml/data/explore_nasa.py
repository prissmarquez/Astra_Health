from pathlib import Path
import pandas as pd

RAW = Path(__file__).parent / "raw"

for file in sorted(RAW.glob("*.csv")):
    df = pd.read_csv(file)
    print("=" * 80)
    print(f"{file.name}")
    print(f"Rows x columns: {df.shape}")
    print("\nColumns:")
    print(list(df.columns))
    print("\nFirst rows:")
    print(df.head())
    print("\nMissing values per column:")
    print(df.isna().sum()[df.isna().sum() > 0])
