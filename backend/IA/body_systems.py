"""Body systems of the Body AI screen (frontend/BodyAi.html).

Maps each system to the indicators that describe it and builds the pieces of
GET /body/{system}: the status pill, the metric with its 14-day line, and the
"Updated: x min ago" text. The AI text comes from explainer.py.

Only measured indicators are used: a system with no sensor says so instead of
inventing a value.
"""

from datetime import datetime, timezone

from templates import DEVIATION, ENGINE_NAMES
from validation import VALID_RANGES

# code used by the front-end -> name, indicators (ML names), main indicator for the metric
SYSTEMS = {
    "cardio": {"name": "Cardiovascular system", "main": "heart_rate",
               "indicators": ["heart_rate", "hrv", "systolic_pressure", "diastolic_pressure"]},
    "resp": {"name": "Respiratory system", "main": "spo2", "indicators": ["spo2"]},
    "digest": {"name": "Digestive system", "main": "glucose", "indicators": ["glucose"]},
    "muscle": {"name": "Muscular system", "main": None, "indicators": []},
    "nerv": {"name": "Nervous system", "main": "hrv",
             "indicators": ["hrv", "sleep_min", "positive_mood", "negative_mood"]},
    "immune": {"name": "Immune system", "main": "temperature", "indicators": ["temperature"]},
    "thermo": {"name": "Thermoregulation", "main": "temperature", "indicators": ["temperature"]},
}

# clinical reason written by health_engine.clinical() -> indicators it is about
REASON_INDICATORS = {
    "low SpO2": ["spo2"],
    "high temperature": ["temperature"],
    "very high temperature during exercise": ["temperature"],
    "HR out of range": ["heart_rate"],
    "high pressure": ["systolic_pressure", "diastolic_pressure"],
    "low pressure": ["systolic_pressure", "diastolic_pressure"],
    "glucose out of range": ["glucose"],
    "severe habitual sleep deficit": ["sleep_min"],
    "advisory: habitual sleep below 6 h": ["sleep_min"],
}


def flagged_indicators(analysis: dict) -> set[str]:
    """Indicators named by a clinical reason or a deviation of the analysis."""
    flagged = set()
    for reason in analysis.get("clinical_reasons") or []:
        flagged.update(REASON_INDICATORS.get(reason, []))
    for deviation in analysis.get("deviations") or []:
        match = DEVIATION.match(deviation)
        if match and match["name"] in ENGINE_NAMES:
            flagged.add(ENGINE_NAMES[match["name"]])
    return flagged


def system_status(system: str, analysis: dict) -> str:
    """'attention' (red and about this system), 'watch' (something in this system), 'stable'."""
    touched = flagged_indicators(analysis) & set(SYSTEMS[system]["indicators"])
    if not touched:
        return "stable"
    return "attention" if analysis.get("traffic_light") == "red" else "watch"


def system_metric(system: str, rows: list[dict]) -> dict:
    """Latest value of the main indicator, its trend vs the previous days and
    the line points (oldest first). rows: daily_readings, newest day first."""
    main = SYSTEMS[system]["main"]
    if main is None:
        return {}
    values = [float(r[main]) for r in reversed(rows) if r.get(main) is not None]
    if not values:
        return {}
    latest, previous = values[-1], values[:-1]
    trend = ""
    if previous:
        average = sum(previous) / len(previous)
        if average:
            trend = f"{(latest - average) / average * 100:+.0f}% vs. average"
    _, _, unit, name = VALID_RANGES[main]
    return {"label": f"{name} · latest reading", "value": round(latest, 1), "unit": unit,
            "trend": trend, "points": [round(v, 1) for v in values]}


def updated_ago(when: str | datetime | None, now: datetime | None = None) -> str:
    """'just now', '5 min ago', '3 h ago', '2 days ago'."""
    if not when:
        return ""
    if isinstance(when, str):
        when = datetime.fromisoformat(when.replace("Z", "+00:00"))
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    minutes = int(((now or datetime.now(timezone.utc)) - when).total_seconds() // 60)
    if minutes < 1:
        return "just now"
    if minutes < 60:
        return f"{minutes} min ago"
    if minutes < 24 * 60:
        return f"{minutes // 60} h ago"
    days = minutes // (24 * 60)
    return f"{days} day{'s' if days > 1 else ''} ago"


def focus(system: str) -> dict:
    """What the AI should centre its explanation on."""
    return {"system": SYSTEMS[system]["name"], "indicators": SYSTEMS[system]["indicators"]}


LIGHT_FOR_STATUS = {"stable": "green", "watch": "yellow", "attention": "red"}


def focused(system: str, analysis: dict, values: dict) -> tuple[dict, dict]:
    """The part of the analysis and values that belongs to this system.

    Red stays complete, so the AI can still warn about an alert in another
    system. Otherwise only this system's findings are kept and the light is
    the system's own, so the AI cannot drift into other systems."""
    if analysis.get("traffic_light") == "red":
        return analysis, values
    mine = set(SYSTEMS[system]["indicators"])
    status = system_status(system, analysis)

    def about_mine(text: str) -> bool:
        match = DEVIATION.match(text)
        if match:
            return ENGINE_NAMES.get(match["name"]) in mine
        return bool(set(REASON_INDICATORS.get(text, [])) & mine)

    part = {
        **analysis,
        "traffic_light": LIGHT_FOR_STATUS[status],
        "clinical_reasons": [r for r in analysis.get("clinical_reasons") or [] if about_mine(r)],
        "deviations": [d for d in analysis.get("deviations") or [] if about_mine(d)],
        "connections": list(analysis.get("connections") or []) if status != "stable" else [],
        "detected_by_ml": bool(analysis.get("detected_by_ml")) and status != "stable",
    }
    return part, {k: v for k, v in values.items() if k in mine}
