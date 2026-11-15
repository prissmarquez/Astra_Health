"""Turns the ML health analysis into a short explanation for the astronaut.

The ML (backend/ml/health_engine.py) decides the traffic light and why.
Claude only puts that result into words, using the facts the backend read
from the database (values, exercising flag). It never decides on its own.

Fallback chain, so an explanation is always returned:
    Claude -> same input already explained (cache) -> demo scenarios -> template
The "source" field says which one answered: "ai", "cache", "demo" or "template".
"""

import json
import logging
import time

import anthropic

from cache import ResponseCache, cache_key
from config import Settings, cost_usd, load_settings
from schemas import Explanation
from templates import template_explanation

log = logging.getLogger("astra.ia")

SYSTEM_PROMPT = """You explain health readings to an astronaut on a space mission, inside the Astra Health app.

You receive two JSON objects:
- "analysis": the result of the ML health engine. It already decided the traffic light (green / yellow / red) and why: clinical thresholds crossed, deviations from the astronaut's own normal (in standard deviations), related indicators, and whether the anomaly model flagged the reading.
- "context": facts stored in the database for this reading, such as the measured values and whether the astronaut was exercising.

Rules:
- Only use facts present in "analysis" and "context". Never invent values, causes, history or diagnoses.
- Do not change the traffic light or contradict the analysis. Explain it.
- Mention exercise as a possible reason only if context.exercising is true. If it is false or missing, do not mention exercise, activity or training at all, not even to rule it out (never write "you were not exercising").
- When context.exercising is true, say that a higher temperature or heart rate is expected after exercise.
- This is not a medical diagnosis. For red, tell the astronaut to contact the mission medical team.
- Be calm, short and clear: "summary" in 1-2 sentences, "detail" in 2-3 sentences, at most 3 recommendations.
- Write everything in {language}."""

LANGUAGE_NAMES = {"en": "English", "es": "Spanish"}


class Explainer:
    def __init__(self, settings: Settings | None = None, client=None):
        self.settings = settings or load_settings()
        self._client = client
        self.cache = ResponseCache(self.settings.cache_path)
        self.demo = ResponseCache(self.settings.demo_path, writable=False)

    @property
    def client(self):
        if self._client is None:
            self._client = anthropic.Anthropic(
                api_key=self.settings.api_key,
                timeout=self.settings.timeout,
                max_retries=1,
            )
        return self._client

    def ask_claude(self, analysis: dict, context: dict, language: str):
        """One call to Claude. Raises on any problem (handled by explain)."""
        response = self.client.messages.parse(
            model=self.settings.model,
            max_tokens=2048,
            system=SYSTEM_PROMPT.format(language=LANGUAGE_NAMES[language]),
            messages=[{
                "role": "user",
                "content": json.dumps(
                    {"analysis": analysis, "context": context},
                    ensure_ascii=False, default=str,
                ),
            }],
            output_config={"effort": "low"},
            output_format=Explanation,
        )
        if response.stop_reason == "refusal":
            raise RuntimeError("Claude declined the request (refusal)")
        if response.stop_reason == "max_tokens" or response.parsed_output is None:
            raise RuntimeError(f"Claude returned no usable explanation ({response.stop_reason})")
        return response

    def explain(self, analysis: dict, context: dict | None = None,
                language: str | None = None) -> dict:
        context = context or {}
        language = language if language in LANGUAGE_NAMES else self.settings.language
        key = cache_key(analysis, context, language)
        reason = None

        if not self.settings.enabled:
            reason = "AI disabled (AI_ENABLED=false)"
        elif not self.settings.api_key:
            reason = "missing ANTHROPIC_API_KEY"
        else:
            started = time.perf_counter()
            try:
                response = self.ask_claude(analysis, context, language)
                result = {
                    **response.parsed_output.model_dump(),
                    "source": "ai",
                    "model": response.model,
                    "language": language,
                    "latency_s": round(time.perf_counter() - started, 2),
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                    "cost_usd": cost_usd(self.settings.model, response.usage.input_tokens,
                                         response.usage.output_tokens),
                }
                self.cache.put(key, {**response.parsed_output.model_dump(), "model": response.model})
                return result
            except anthropic.AuthenticationError:
                reason = "invalid ANTHROPIC_API_KEY"
            except anthropic.PermissionDeniedError:
                reason = "the API key has no permission (or no credit)"
            except anthropic.NotFoundError:
                reason = f"model not found: {self.settings.model}"
            except anthropic.RateLimitError:
                reason = "rate limit reached"
            except anthropic.BadRequestError as e:
                reason = f"bad request: {e.message}"   # e.g. credit balance too low
            except anthropic.APITimeoutError:
                reason = f"Claude took more than {self.settings.timeout}s"
            except anthropic.APIConnectionError:
                reason = "no connection to Claude (internet down?)"
            except anthropic.APIStatusError as e:
                reason = f"Claude error {e.status_code}"
            except Exception as e:  # the app must never break because of the AI
                reason = f"unexpected error: {e}"
            log.warning("AI explanation failed, using fallback: %s", reason)

        for source, store in (("cache", self.cache), ("demo", self.demo)):
            saved = store.get(key)
            if saved:
                return {**Explanation(**saved).model_dump(), "source": source,
                        "model": saved.get("model"), "language": language,
                        "fallback_reason": reason}

        text = template_explanation(analysis, context, language)
        return {**text.model_dump(), "source": "template", "model": None,
                "language": language, "fallback_reason": reason}


_default: Explainer | None = None


def explain(analysis: dict, context: dict | None = None, language: str | None = None) -> dict:
    """What FastAPI calls after health_engine.analyze()."""
    global _default
    if _default is None:
        _default = Explainer()
    return _default.explain(analysis, context, language)
