"""Settings for the AI explainer, read from backend/IA/.env (never committed)."""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE = Path(__file__).parent
load_dotenv(BASE / ".env")

# USD per million tokens (input, output). Used only to show the cost of a call.
PRICES = {
    "claude-haiku-5-5": (0.10, 0.50),
    "claude-sonnet-5-5": (2.00, 10.00),
    "claude-opus-5-5": (4.00, 20.00),
}


def _flag(name: str, default: bool) -> bool:
    value = os.environ.get(name, "").strip().lower()
    if not value:
        return default
    return value in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    api_key: str
    model: str
    enabled: bool          # False -> always use the template (test the fallback)
    timeout: float         # seconds before giving up on Claude
    language: str          # "en" or "es"
    cache_path: Path       # explanations Claude already wrote (local, not in git)
    demo_path: Path        # pre-generated scenario explanations (in git)


def load_settings() -> Settings:
    language = os.environ.get("EXPLANATION_LANGUAGE", "en").strip().lower()
    return Settings(
        api_key=os.environ.get("ANTHROPIC_API_KEY", "").strip(),
        model=os.environ.get("CLAUDE_MODEL", "claude-haiku-5-5").strip(),
        enabled=_flag("AI_ENABLED", True),
        timeout=float(os.environ.get("AI_TIMEOUT", "15")),
        language=language if language in {"en", "es"} else "en",
        cache_path=BASE / ".cache" / "responses.json",
        demo_path=BASE / "demo_responses.json",
    )


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float | None:
    if model not in PRICES:
        return None
    price_in, price_out = PRICES[model]
    return (input_tokens * price_in + output_tokens * price_out) / 1_000_000
