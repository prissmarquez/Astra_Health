"""Impossible readings (sensor/entry errors) get "Error measuring the data",
never a health analysis. No Claude call, no credit spent.

    python -m pytest
"""

import re
from pathlib import Path

import pytest

from config import Settings
from explainer import Explainer
from scenarios import SCENARIOS
from validation import VALID_RANGES, out_of_range

CATALOGS = Path(__file__).resolve().parents[2] / "DataBase" / "migrations" / "003_catalogs.sql"
# 009_rename_indicators_to_ml.sql renamed these codes to the ML names
DB_TO_ML = {"systolic_bp": "systolic_pressure", "diastolic_bp": "diastolic_pressure",
            "mood_positive": "positive_mood", "mood_negative": "negative_mood"}


def test_ranges_match_the_database():
    """If someone changes a limit in the DB, this copy must change too."""
    rows = re.findall(r"\('(\w+)',\s*'[^']*',\s*'[^']*',\s*(-?[\d.]+),\s*(-?[\d.]+),",
                      CATALOGS.read_text(encoding="utf-8"))
    db = {DB_TO_ML.get(code, code): (float(low), float(high)) for code, low, high in rows}
    for indicator, (low, high, _, _) in VALID_RANGES.items():
        assert db[indicator] == (low, high), indicator


@pytest.mark.parametrize("values", [
    {"heart_rate": 0},
    {"spo2": 120},
    {"temperature": 10},
    {"glucose": 0, "systolic_pressure": 0},
])
def test_impossible_values_are_caught(values):
    assert {p["indicator"] for p in out_of_range(values)} == set(values)


@pytest.mark.parametrize("values", [
    {"heart_rate": 20, "spo2": 100, "temperature": 45},  # exactly on the limits
    {"sleep_min": 0},                                      # no sleep is possible
    {"heart_rate": None, "unknown_indicator": -5},         # ignored
])
def test_possible_values_pass(values):
    assert out_of_range(values) == []


@pytest.fixture
def explainer(tmp_path):
    settings = Settings(api_key="test-key", model="claude-haiku-5-5", enabled=True, timeout=5,
                        cache_path=tmp_path / "cache.json", demo_path=tmp_path / "demo.json")
    calls = []

    class NeverCalled:
        class messages:
            @staticmethod
            def parse(**kwargs):
                calls.append(kwargs)
                raise AssertionError("Claude must not be called for an impossible reading")

    return Explainer(settings, client=NeverCalled()), calls


def test_zero_heart_rate_is_a_measurement_error_not_low(explainer):
    explainer, calls = explainer
    case = SCENARIOS["normal"]
    context = {**case["context"], "values": {**case["context"]["values"], "heart_rate": 0}}
    result = explainer.explain(case["analysis"], context)
    assert result["source"] == "measurement_error"
    assert result["summary"] == "Error measuring the data."
    assert "Heart rate: 0 bpm" in result["detail"]
    assert "low" not in result["detail"].lower()
    assert calls == []
