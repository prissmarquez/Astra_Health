"""Fallback explanation built only from the ML output, without any AI.

Used when Claude is disabled, unreachable, out of credit or refuses. It is
less natural but always available, and it never invents data: it only
repeats what the ML found and the context stored in the database, turned
into plain words (no σ, no internal names).
"""

import re

from schemas import Explanation

# Indicator name used by health_engine.py -> key in context["values"]
ENGINE_NAMES = {
    "HR": "heart_rate",
    "HRV": "hrv",
    "sleep": "sleep_min",
    "positive mood": "positive_mood",
    "negative mood": "negative_mood",
    "glucose": "glucose",
    "systolic pressure": "systolic_pressure",
    "diastolic pressure": "diastolic_pressure",
    "temperature": "temperature",
    "SpO2": "spo2",
}
UNITS = {
    "heart_rate": "bpm", "hrv": "ms", "sleep_min": "min", "positive_mood": "/50",
    "negative_mood": "/50", "glucose": "mg/dL", "systolic_pressure": "mmHg",
    "diastolic_pressure": "mmHg", "temperature": "°C", "spo2": "%",
}
# "temperature ↑ (+3.4σ)" as written by health_engine.explain()
DEVIATION = re.compile(r"^(?P<name>.+) (?P<arrow>[↑↓]) \((?P<z>[+-]?\d+(?:\.\d+)?)σ\)$")

TEXT = {
    "green": "Your body is stable overall.",
    "yellow": "Something is worth keeping an eye on: a value is outside your usual range.",
    "red": "One value needs attention now: it is outside the safe range.",
    "startup": "There are still only a few days of history, so only the medical limits were checked.",
    "reasons": "It crossed a medical limit: {}.",
    "deviations": "Compared with your previous days: {}.",
    "ml": "The system also noticed an unusual pattern compared with your history.",
    "exercising": "You recorded exercise, so a higher temperature and heart rate are expected.",
    "nothing": "All your values are within your usual range.",
    "rec_green": "Keep your routine and take your next reading on time.",
    "rec_yellow": "Rest for a few minutes and repeat the reading in 15 min.",
    "rec_red": "Contact the mission medical team now.",
    "rec_exercise": "Repeat the reading after resting 15-30 minutes.",
    "rec_hydrate": "Drink a glass of water.",
    "and": " and ",
    "up": "above", "down": "below",
    "moderate": "moderately {} your usual", "clear": "clearly {} your usual",
    "names": {
        "heart_rate": "your heart rate", "hrv": "your HRV (heart rate variability)",
        "sleep_min": "your sleep", "positive_mood": "your positive mood",
        "negative_mood": "your negative mood", "glucose": "your glucose",
        "systolic_pressure": "your systolic pressure (the top number)",
        "diastolic_pressure": "your diastolic pressure (the bottom number)",
        "temperature": "your temperature", "spo2": "your SpO2 (oxygen in your blood)",
    },
    "reason_names": {
        "high temperature": "high temperature",
        "HR out of range": "heart rate out of the healthy range",
        "low SpO2": "low oxygen in your blood (SpO2)",
        "high pressure": "high blood pressure",
        "low pressure": "low blood pressure",
        "glucose out of range": "glucose out of the healthy range",
        "severe habitual sleep deficit": "you have been sleeping far too little",
        "advisory: habitual sleep below 6 h": "you have been sleeping under 6 h on average",
        "very high temperature during exercise": "very high temperature during exercise",
    },
}


def _join(items: list[str], t: dict) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + t["and"] + items[-1]


def _deviation(text: str, values: dict, t: dict) -> str:
    """'temperature ↑ (+3.4σ)' -> 'your temperature: 38.3 °C, clearly above your usual'."""
    match = DEVIATION.match(text)
    key = ENGINE_NAMES.get(match["name"]) if match else None
    if key is None:
        return text                                  # unknown format: show it as is
    direction = t["up"] if match["arrow"] == "↑" else t["down"]
    size = t["clear"] if abs(float(match["z"])) > 3 else t["moderate"]
    name = t["names"][key]
    if values.get(key) is not None:
        name += f": {values[key]:g} {UNITS[key]}"
    return f"{name}, {size.format(direction)}"


def template_explanation(analysis: dict, context: dict) -> Explanation:
    t = TEXT
    light = analysis.get("traffic_light", "green")
    exercising = bool(context.get("exercising", False))
    values = context.get("values") or {}

    parts = []
    if str(analysis.get("mode", "")).startswith("startup"):
        parts.append(t["startup"])
    if analysis.get("clinical_reasons"):
        reasons = [t["reason_names"].get(r, r) for r in analysis["clinical_reasons"]]
        parts.append(t["reasons"].format(_join(reasons, t)))
    if analysis.get("deviations"):
        deviations = [_deviation(d, values, t) for d in analysis["deviations"]]
        parts.append(t["deviations"].format("; ".join(deviations)))
    for link in analysis.get("connections") or []:
        parts.append(link[:1].upper() + link[1:] + ".")
    if analysis.get("detected_by_ml"):
        parts.append(t["ml"])
    if exercising:
        parts.append(t["exercising"])
    if not parts:
        parts.append(t["nothing"])

    recommendations = [t[f"rec_{light}"]]
    if exercising and light != "red":
        recommendations.append(t["rec_exercise"])
    recommendations.append(t["rec_hydrate"])

    return Explanation(
        summary=t[light],
        detail=" ".join(parts),
        recommendations=recommendations[:3],
    )
