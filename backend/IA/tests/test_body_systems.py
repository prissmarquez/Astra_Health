"""Body AI screen helpers (GET /body/{system}). No Claude call.

    python -m pytest
"""

from datetime import datetime, timedelta, timezone

from body_systems import SYSTEMS, flagged_indicators, focused, system_metric, system_status, updated_ago
from scenarios import SCENARIOS
from validation import VALID_RANGES

FEVER = SCENARIOS["fever_resting"]["analysis"]          # yellow: temperature + HR
RED = SCENARIOS["high_temp_no_exercise"]["analysis"]     # red: temperature + HR


def test_every_indicator_is_known():
    for info in SYSTEMS.values():
        assert set(info["indicators"]) <= set(VALID_RANGES)
        assert info["main"] is None or info["main"] in info["indicators"]


def test_flagged_indicators_from_reasons_and_deviations():
    assert flagged_indicators(FEVER) == {"temperature", "heart_rate"}
    pressure = {"clinical_reasons": ["high pressure"], "deviations": ["HRV ↓ (-2.4σ)"]}
    assert flagged_indicators(pressure) == {"systolic_pressure", "diastolic_pressure", "hrv"}


def test_status_depends_on_the_system():
    assert system_status("cardio", FEVER) == "watch"        # heart rate is cardio
    assert system_status("thermo", FEVER) == "watch"
    assert system_status("resp", FEVER) == "stable"         # SpO2 was fine
    assert system_status("cardio", RED) == "attention"
    assert system_status("digest", RED) == "stable"
    assert system_status("cardio", SCENARIOS["normal"]["analysis"]) == "stable"


def test_metric_uses_the_main_indicator_oldest_first():
    rows = [{"heart_rate": 72}, {"heart_rate": None}, {"heart_rate": 66}, {"heart_rate": 68}]  # newest first
    metric = system_metric("cardio", rows)
    assert metric["value"] == 72
    assert metric["points"] == [68, 66, 72]
    assert metric["unit"] == "bpm"
    assert metric["trend"] == "+7% vs. average"             # 72 vs 67


def test_metric_without_sensor_or_data():
    assert system_metric("muscle", [{"heart_rate": 70}]) == {}
    assert system_metric("resp", [{"spo2": None}]) == {}
    assert system_metric("resp", [{"spo2": 98}])["trend"] == ""   # one day: no average yet


def test_updated_ago():
    now = datetime(2026, 11, 15, 12, 0, tzinfo=timezone.utc)
    assert updated_ago((now - timedelta(seconds=20)).isoformat(), now) == "just now"
    assert updated_ago((now - timedelta(minutes=2)).isoformat(), now) == "2 min ago"
    assert updated_ago("2026-11-15T09:00:00Z", now) == "3 h ago"
    assert updated_ago(now - timedelta(days=1), now) == "1 day ago"
    assert updated_ago(None, now) == ""


VALUES = {"heart_rate": 104, "temperature": 38.3, "spo2": 97, "glucose": 85}


def test_focused_keeps_only_this_system_when_not_red():
    part, values = focused("resp", FEVER, VALUES)
    assert part["traffic_light"] == "green"
    assert part["clinical_reasons"] == [] and part["deviations"] == []
    assert part["connections"] == [] and part["detected_by_ml"] is False
    assert values == {"spo2": 97}

    part, values = focused("cardio", FEVER, VALUES)
    assert part["traffic_light"] == "yellow"
    assert part["clinical_reasons"] == ["HR out of range"]
    assert part["deviations"] == ["HR ↑ (+2.6σ)"]
    assert values == {"heart_rate": 104}


def test_focused_keeps_everything_when_red():
    assert focused("digest", RED, VALUES) == (RED, VALUES)
