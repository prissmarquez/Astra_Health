"""Checks that Claude answers with the settings in backend/IA/.env.

Run it once after setting the key, and before every presentation:
    python check_ai.py
Makes ONE real call (a fraction of a cent with Haiku).
Exit code 0 = Claude works, 1 = it does not (the app would use the fallback).
"""

import sys

from config import load_settings
from explainer import Explainer
from scenarios import SCENARIOS


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")   # emojis on the Windows console
    settings = load_settings()
    print(f"Model:     {settings.model}")
    print(f"Language:  {settings.language}")
    print(f"AI on:     {settings.enabled}")
    print(f"API key:   {'set' if settings.api_key else 'MISSING'}")

    case = SCENARIOS["fever_resting"]
    explainer = Explainer(settings)
    explainer.cache.writable = False   # do not answer from (or save) the local cache
    explainer.cache.data = {}
    explainer.demo.data = {}
    result = explainer.explain(case["analysis"], case["context"])

    if result["source"] != "ai":
        print(f"\n❌ Claude did NOT answer: {result['fallback_reason']}")
        print("   The app would show the template explanation instead.")
        return 1

    print(f"\n✅ Claude answered ({result['model']}) in {result['latency_s']} s")
    cost = result["cost_usd"]
    cost_text = f"${cost:.5f} USD" if cost is not None else "unknown price"
    print(f"   Tokens: {result['input_tokens']} in / {result['output_tokens']} out  ->  {cost_text}")
    print(f"\nSummary: {result['summary']}")
    print(f"Detail:  {result['detail']}")
    for rec in result["recommendations"]:
        print(f"  - {rec}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
