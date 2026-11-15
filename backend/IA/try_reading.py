"""Try your own values: the REAL ML engine analyzes them and Claude explains.

    python try_reading.py                                   # asks for each value
    python try_reading.py --temperature 38.6 --heart-rate 130 --exercising
    python try_reading.py --temperature 38.6 --heart-rate 130   # same, no exercise
    python try_reading.py --temperature 39 --no-ai          # only the template

The reading is added to the history of a simulated astronaut
(backend/ml/data/processed/astronaut_dataset_ml.csv), so the ML can compare
it with that astronaut's normal. Values you do not give keep the
astronaut's last value. One run with Claude costs about $0.0002 (Haiku).
"""

import argparse
import sys
import warnings
from pathlib import Path

ML = Path(__file__).resolve().parent.parent / "ml"
sys.path.insert(0, str(ML))

import joblib  # noqa: E402
import pandas as pd  # noqa: E402
from health_engine import IND, NAMES, analyze  # noqa: E402

from config import load_settings  # noqa: E402
from explainer import Explainer  # noqa: E402
from validation import describe, out_of_range  # noqa: E402

# Values you can change: (indicator in the ML, command-line flag, unit)
FIELDS = [
    ("temperature", "temperature", "°C"),
    ("heart_rate", "heart-rate", "bpm"),
    ("hrv", "hrv", "ms"),
    ("spo2", "spo2", "%"),
    ("systolic_pressure", "systolic", "mmHg"),
    ("diastolic_pressure", "diastolic", "mmHg"),
    ("glucose", "glucose", "mg/dL"),
    ("sleep_min", "sleep", "min"),
    ("positive_mood", "positive-mood", "10-50"),
    ("negative_mood", "negative-mood", "10-50"),
]
LIGHTS = {"green": "🟢 GREEN", "yellow": "🟡 YELLOW", "red": "🔴 RED"}


def ask_float(label: str, default: float) -> float:
    while True:
        raw = input(f"  {label} [{default}]: ").strip().replace(",", ".")
        if not raw:
            return default
        try:
            return float(raw)
        except ValueError:
            print("    Type a number, or press Enter to keep the value.")


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--astronaut", default="user_12", help="simulated astronaut whose history is used")
    for _, flag, unit in FIELDS:
        parser.add_argument(f"--{flag}", type=float, help=unit)
    parser.add_argument("--exercising", action="store_true", help="the reading was taken during/after exercise")
    parser.add_argument("--no-ai", action="store_true", help="do not call Claude (template only)")
    args = parser.parse_args()

    data = pd.read_csv(ML / "data" / "processed" / "astronaut_dataset_ml.csv")
    history = data[data["astronaut"] == args.astronaut]
    if history.empty:
        print(f"Unknown astronaut {args.astronaut}. Options: {', '.join(sorted(data['astronaut'].unique()))}")
        return 1
    history = history[history["day"] < 20]          # 20 normal days of history
    last = history.iloc[-1]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")              # sklearn version notice
        package = joblib.load(ML / "isolation_forest_model.pkl")

    given = {name: getattr(args, flag.replace("-", "_")) for name, flag, _ in FIELDS}
    interactive = all(v is None for v in given.values()) and not args.exercising
    reading = last[["astronaut", "mission", "phase", "adaptation"] + IND].to_dict()
    reading["day"] = int(last["day"]) + 1

    if interactive:
        print(f"Astronaut {args.astronaut} ({last['mission']} mission, {last['phase']}).")
        print("Press Enter to keep the usual value, or type a new one:")
        for name, _, unit in FIELDS:
            reading[name] = ask_float(f"{NAMES[name]} ({unit})", round(float(last[name]), 1))
        reading["exercising"] = input("  Exercising during/just before the reading? (y/n) [n]: ").strip().lower() in {"y", "s", "yes", "si", "sí"}
    else:
        for name, value in given.items():
            if value is not None:
                reading[name] = value
        reading["exercising"] = args.exercising

    problems = out_of_range({name: reading[name] for name, _, _ in FIELDS})
    if problems:  # sensor/entry error: do not run the ML or the AI on it
        print("\n⚠️  Error measuring the data")
        for problem in problems:
            print(f"   {describe(problem)}")
        print("   This looks like a sensor or entry error, not a change in health.")
        print("   Nothing was analysed. Check the sensor and take the reading again.")
        return 2

    analysis = analyze(history, reading, package)

    print("\n=== ML result (backend/ml/health_engine.py) ===")
    print(f"Traffic light:    {LIGHTS[analysis['traffic_light']]}")
    print(f"Mode:             {analysis['mode']}")
    print(f"Clinical reasons: {', '.join(analysis['clinical_reasons']) or '-'}")
    print(f"Deviations:       {', '.join(analysis['deviations']) or '-'}")
    print(f"Connections:      {', '.join(analysis['connections']) or '-'}")
    print(f"Flagged by ML:    {analysis['detected_by_ml']}")
    print(f"Exercising:       {reading['exercising']}")

    settings = load_settings()
    if args.no_ai:
        settings = settings.__class__(**{**settings.__dict__, "enabled": False})
    context = {
        "exercising": bool(reading["exercising"]),
        "values": {name: round(float(reading[name]), 1) for name, _, _ in FIELDS},
    }
    result = Explainer(settings).explain(analysis, context)

    print(f"\n=== Explanation (source: {result['source']}) ===")
    print(result["summary"])
    print(result["detail"])
    for rec in result["recommendations"]:
        print(f"  - {rec}")
    if result["source"] == "ai":
        cost = result["cost_usd"]
        print(f"\n({result['model']}, {result['latency_s']} s"
              + (f", ${cost:.5f} USD)" if cost is not None else ")"))
    else:
        print(f"\n(fallback reason: {result['fallback_reason']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
