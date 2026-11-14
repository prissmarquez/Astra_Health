from pathlib import Path
import pandas as pd

MMASH = Path(__file__).parent / "raw" / "MMASH"
usuario = next(MMASH.rglob("user_1"))

for archivo in sorted(usuario.glob("*.csv")):
    df = pd.read_csv(archivo)
    print("=" * 80)
    print(f" {archivo.name}  {df.shape}")
    print(list(df.columns))
    print(df.head(3))