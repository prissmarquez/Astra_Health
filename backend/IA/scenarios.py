"""Fixed test cases: what health_engine.analyze() returns for known readings,
plus the database context. Used by run_scenarios.py (live, with Claude)
and by the tests (without Claude).

The analysis strings are the exact ones health_engine.py produces.
Cases 3 and 4 are the SAME values; only the exercising flag changes.
"""

import re

SCENARIOS = {
    "normal": {
        "description": "Everything within the usual range",
        "analysis": {
            "traffic_light": "green", "mode": "personal",
            "clinical_reasons": [], "deviations": [], "connections": [],
            "detected_by_ml": False,
        },
        "context": {
            "exercising": False,
            "values": {"heart_rate": 68, "temperature": 36.8, "spo2": 98,
                       "systolic_pressure": 112, "diastolic_pressure": 72},
        },
    },
    "fever_resting": {
        "description": "Fever at rest: temperature and heart rate up together",
        "analysis": {
            "traffic_light": "yellow", "mode": "personal",
            "clinical_reasons": ["high temperature", "HR out of range"],
            "deviations": ["temperature ↑ (+3.4σ)", "HR ↑ (+2.6σ)"],
            "connections": ["fever speeds up the heart"],
            "detected_by_ml": True,
        },
        "context": {
            "exercising": False,
            "values": {"heart_rate": 104, "temperature": 38.3, "spo2": 97},
        },
    },
    "high_temp_after_exercise": {
        "description": "High temperature and heart rate, recorded during exercise",
        "analysis": {
            "traffic_light": "green", "mode": "personal",
            "clinical_reasons": [], "deviations": [], "connections": [],
            "detected_by_ml": False,
        },
        "context": {
            "exercising": True,
            "values": {"heart_rate": 135, "temperature": 38.6, "spo2": 97},
        },
    },
    "high_temp_no_exercise": {
        "description": "Same values as the previous case, but NO exercise recorded",
        "analysis": {
            "traffic_light": "red", "mode": "personal",
            "clinical_reasons": ["high temperature", "HR out of range"],
            "deviations": ["temperature ↑ (+4.1σ)", "HR ↑ (+5.2σ)"],
            "connections": ["fever speeds up the heart"],
            "detected_by_ml": True,
        },
        "context": {
            "exercising": False,
            "values": {"heart_rate": 135, "temperature": 38.6, "spo2": 97},
        },
    },
}

_EXERCISE_WORDS = re.compile(
    r"exercis|workout|training|physical activity|ejercicio|entrenamiento|actividad f[ií]sica",
    re.IGNORECASE,
)


def mentions_exercise(explanation: dict) -> bool:
    text = " ".join([explanation.get("summary", ""), explanation.get("detail", ""),
                     *explanation.get("recommendations", [])])
    return bool(_EXERCISE_WORDS.search(text))


def check(name: str, explanation: dict) -> list[str]:
    """Problems found in an explanation (empty list = it passed)."""
    case = SCENARIOS[name]
    problems = []
    exercising = case["context"]["exercising"]
    if not exercising and mentions_exercise(explanation):
        problems.append("mentions exercise, but exercising is false (invented cause)")
    if exercising and not mentions_exercise(explanation):
        problems.append("does not mention exercise, but exercising is true")
    if not explanation.get("summary") or not explanation.get("detail"):
        problems.append("empty summary or detail")
    if not 1 <= len(explanation.get("recommendations", [])) <= 3:
        problems.append("must have 1 to 3 recommendations")
    return problems
