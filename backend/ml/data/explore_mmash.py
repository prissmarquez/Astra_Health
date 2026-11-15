from pathlib import Path
import pandas as pd

MMASH = Path(__file__).parent / "raw" / "MMASH"
user = next(MMASH.rglob("user_1"))

for file in sorted(user.glob("*.csv")):
    df = pd.read_csv(file)
    print("=" * 80)
    print(f" {file.name}  {df.shape}")
    print(list(df.columns))
    print(df.head(3))