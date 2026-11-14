from pathlib import Path
import pandas as pd

RAW = Path(__file__).parent / "raw"

for archivo in sorted(RAW.glob("*.csv")):
    df = pd.read_csv(archivo)
    print("=" * 80)
    print(f"{archivo.name}")
    print(f"Filas x columnas: {df.shape}")
    print("\nColumnas:")
    print(list(df.columns))
    print("\nPrimeras filas:")
    print(df.head())
    print("\nValores vacíos por columna:")
    print(df.isna().sum()[df.isna().sum() > 0])
