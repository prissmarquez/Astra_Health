"""Runs the 4 fixed scenarios through the explainer and checks each answer.

    python run_scenarios.py                # live with Claude (4 calls)
    python run_scenarios.py --save         # also saves them to demo_responses.json
    python run_scenarios.py --language es  # in Spanish

The key check: Claude must mention exercise ONLY when exercising is true.
demo_responses.json is the safety net for the presentation: if Claude fails
on one of these exact inputs, the app shows the saved explanation.
"""

import argparse
import json
import sys

from cache import cache_key
from config import load_settings
from explainer import Explainer
from scenarios import SCENARIOS, check


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")   # emojis on the Windows console
    parser = argparse.ArgumentParser()
    parser.add_argument("--save", action="store_true", help="save Claude's answers as demo responses")
    parser.add_argument("--language", choices=["en", "es"], default=None)
    args = parser.parse_args()

    settings = load_settings()
    language = args.language or settings.language
    explainer = Explainer(settings)
    explainer.cache.data, explainer.demo.data = {}, {}   # force fresh answers
    explainer.cache.writable = False

    demo = {}
    if settings.demo_path.exists():
        demo = json.loads(settings.demo_path.read_text(encoding="utf-8"))

    failed = 0
    for name, case in SCENARIOS.items():
        result = explainer.explain(case["analysis"], case["context"], language)
        problems = check(name, result)
        status = "✅" if not problems else "❌"
        failed += bool(problems)
        print(f"\n{status} {name} [{case['analysis']['traffic_light']}, "
              f"exercising={case['context']['exercising']}] -> source: {result['source']}")
        print(f"   {case['description']}")
        print(f"   Summary: {result['summary']}")
        print(f"   Detail:  {result['detail']}")
        for rec in result["recommendations"]:
            print(f"     - {rec}")
        for problem in problems:
            print(f"   PROBLEM: {problem}")
        if result["source"] != "ai":
            print(f"   (fallback reason: {result['fallback_reason']})")
        if args.save and result["source"] == "ai" and not problems:
            key = cache_key(case["analysis"], case["context"], language)
            demo[key] = {"summary": result["summary"], "detail": result["detail"],
                         "recommendations": result["recommendations"],
                         "model": result["model"], "scenario": name}

    if args.save:
        settings.demo_path.write_text(json.dumps(demo, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nSaved {len(demo)} demo responses to {settings.demo_path.name}")

    print(f"\n{len(SCENARIOS) - failed}/{len(SCENARIOS)} scenarios passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
