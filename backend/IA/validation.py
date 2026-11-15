"""Catches impossible readings (sensor or entry errors) before the ML and the AI.

A heart rate of 0 bpm is not "low": the sensor failed or the value was typed
wrong. Analysing it would give a false alarm, so the reading is rejected with
an "Error measuring the data" message instead.

The ranges are a copy of the indicators table in the database
(backend/DataBase/migrations/003_catalogs.sql), with the ML names.
They only catch data errors; they are NOT clinical thresholds.
tests/test_validation.py checks that this copy matches the SQL file.
"""

from schemas import Explanation

# indicator (ML name): (min, max, unit, readable name)
VALID_RANGES = {
    "heart_rate": (20, 250, "bpm", "Heart rate"),
    "hrv": (1, 300, "ms", "HRV (heart rate variability)"),
    "spo2": (50, 100, "%", "SpO2 (oxygen in your blood)"),
    "systolic_pressure": (50, 260, "mmHg", "Systolic pressure"),
    "diastolic_pressure": (30, 160, "mmHg", "Diastolic pressure"),
    "temperature": (30, 45, "°C", "Temperature"),
    "glucose": (20, 600, "mg/dL", "Glucose"),
    "sleep_min": (0, 1440, "min", "Sleep"),
    "positive_mood": (10, 50, "points", "Positive mood"),
    "negative_mood": (10, 50, "points", "Negative mood"),
}


def out_of_range(values: dict) -> list[dict]:
    """Values outside the possible range (empty list = all fine).
    Unknown indicators and missing values are ignored."""
    problems = []
    for indicator, value in (values or {}).items():
        if indicator not in VALID_RANGES or value is None:
            continue
        low, high, unit, name = VALID_RANGES[indicator]
        if not low <= float(value) <= high:
            problems.append({"indicator": indicator, "name": name, "value": value,
                             "min": low, "max": high, "unit": unit})
    return problems


def describe(problem: dict) -> str:
    """'Heart rate: 0 bpm is outside the possible range (20-250 bpm)'."""
    return (f"{problem['name']}: {problem['value']:g} {problem['unit']} is outside "
            f"the possible range ({problem['min']:g}-{problem['max']:g} {problem['unit']})")


def error_message(problems: list[dict]) -> str:
    """One line for API errors and logs."""
    return "Error measuring the data. " + "; ".join(describe(p) for p in problems) + "."


def measurement_error(problems: list[dict]) -> dict:
    """Explanation shown instead of a health analysis. Never calls Claude."""
    detail = (". ".join(describe(p) for p in problems)
              + ". This looks like a sensor or entry error, not a change in your health.")
    text = Explanation(
        summary="Error measuring the data.",
        detail=detail,
        recommendations=[
            "Check that the sensor is placed correctly.",
            "Take the reading again.",
        ],
    )
    return {**text.model_dump(), "source": "measurement_error", "model": None,
            "invalid_values": problems}
