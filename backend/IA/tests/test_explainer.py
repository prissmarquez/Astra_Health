"""Tests for the explainer. They never call Claude (no credit is spent):
a fake client returns answers or raises the same errors the real SDK raises.

    python -m pytest
"""

import json
from types import SimpleNamespace

import anthropic
import httpx2
import pytest

from cache import cache_key
from config import Settings
from explainer import Explainer
from scenarios import SCENARIOS, check
from schemas import Explanation

REQUEST = httpx2.Request("POST", "https://api.anthropic.com/v1/messages")


def status_error(cls, code):
    return cls("simulated", response=httpx2.Response(code, request=REQUEST), body=None)


ERRORS = {
    "no internet": anthropic.APIConnectionError(request=REQUEST),
    "timeout": anthropic.APITimeoutError(request=REQUEST),
    "invalid key": status_error(anthropic.AuthenticationError, 401),
    "no credit": status_error(anthropic.BadRequestError, 400),
    "rate limit": status_error(anthropic.RateLimitError, 429),
    "server down": status_error(anthropic.InternalServerError, 500),
    "overloaded": status_error(anthropic.APIStatusError, 529),
    "unexpected": ValueError("boom"),
}

GOOD = Explanation(summary="All good.", detail="Values are normal.", recommendations=["Keep going."])


class FakeClient:
    """Stands in for anthropic.Anthropic(); records every call."""

    def __init__(self, error=None, stop_reason="end_turn", parsed=GOOD):
        self.calls = []

        def parse(**kwargs):
            self.calls.append(kwargs)
            if error:
                raise error
            return SimpleNamespace(
                stop_reason=stop_reason, parsed_output=parsed, model="claude-haiku-5-5",
                usage=SimpleNamespace(input_tokens=900, output_tokens=150),
            )

        self.messages = SimpleNamespace(parse=parse)


@pytest.fixture
def settings(tmp_path):
    return Settings(api_key="test-key", model="claude-haiku-5-5", enabled=True, timeout=5,
                    cache_path=tmp_path / "cache.json",
                    demo_path=tmp_path / "demo.json")


def make(settings, **fake):
    client = FakeClient(**fake)
    return Explainer(settings, client=client), client


CASE = SCENARIOS["fever_resting"]


# ---------- Claude works ----------------------------------------------------

def test_claude_answer_is_used(settings):
    explainer, client = make(settings)
    result = explainer.explain(CASE["analysis"], CASE["context"])
    assert result["source"] == "ai"
    assert result["summary"] == "All good."
    assert result["cost_usd"] == pytest.approx((900 * 0.10 + 150 * 0.50) / 1e6)
    assert settings.cache_path.exists()          # saved for later fallback


def test_claude_receives_only_the_ml_result_and_db_context(settings):
    explainer, client = make(settings)
    explainer.explain(CASE["analysis"], CASE["context"])
    sent = json.loads(client.calls[0]["messages"][0]["content"])
    assert sent == {"analysis": CASE["analysis"], "context": CASE["context"]}
    assert client.calls[0]["model"] == "claude-haiku-5-5"
    assert "only if context.exercising is true" in client.calls[0]["system"]


# ---------- Claude fails: the app still answers ---------------------------

@pytest.mark.parametrize("name", ERRORS)
def test_any_claude_error_falls_back_to_template(settings, name):
    explainer, _ = make(settings, error=ERRORS[name])
    result = explainer.explain(CASE["analysis"], CASE["context"])
    assert result["source"] == "template"
    assert result["fallback_reason"]
    assert result["summary"] and result["detail"] and result["recommendations"]


def test_refusal_falls_back(settings):
    explainer, _ = make(settings, stop_reason="refusal", parsed=None)
    result = explainer.explain(CASE["analysis"], CASE["context"])
    assert result["source"] == "template"
    assert "refusal" in result["fallback_reason"]


def test_disabled_never_calls_claude(settings):
    settings = Settings(**{**settings.__dict__, "enabled": False})
    explainer, client = make(settings)
    result = explainer.explain(CASE["analysis"], CASE["context"])
    assert result["source"] == "template"
    assert client.calls == []


def test_missing_key_never_calls_claude(settings):
    settings = Settings(**{**settings.__dict__, "api_key": ""})
    explainer, client = make(settings)
    result = explainer.explain(CASE["analysis"], CASE["context"])
    assert result["source"] == "template"
    assert "ANTHROPIC_API_KEY" in result["fallback_reason"]
    assert client.calls == []


def test_cached_answer_is_reused_when_claude_fails(settings):
    ok, _ = make(settings)
    ok.explain(CASE["analysis"], CASE["context"])
    broken, _ = make(settings, error=ERRORS["no internet"])
    result = broken.explain(CASE["analysis"], CASE["context"])
    assert result["source"] == "cache"
    assert result["summary"] == "All good."


def test_demo_answer_is_used_when_claude_fails(settings):
    key = cache_key(CASE["analysis"], CASE["context"])
    settings.demo_path.write_text(json.dumps({key: {
        "summary": "Demo summary.", "detail": "Demo detail.",
        "recommendations": ["Demo tip."], "model": "claude-haiku-5-5"}}))
    explainer, _ = make(settings, error=ERRORS["server down"])
    result = explainer.explain(CASE["analysis"], CASE["context"])
    assert result["source"] == "demo"
    assert result["summary"] == "Demo summary."


# ---------- Template: never invents exercise -------------------------------

@pytest.mark.parametrize("name", SCENARIOS)
def test_template_passes_scenario_checks(settings, name):
    settings = Settings(**{**settings.__dict__, "enabled": False})
    explainer, _ = make(settings)
    case = SCENARIOS[name]
    result = explainer.explain(case["analysis"], case["context"])
    assert check(name, result) == []


def test_check_catches_invented_exercise():
    invented = {"summary": "High temperature.", "detail": "Probably from your workout.",
                "recommendations": ["Rest."]}
    assert check("high_temp_no_exercise", invented)
