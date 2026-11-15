"""Stores explanations by their exact input, so they can be reused.

Two files with the same format ({key: explanation}):
  * .cache/responses.json - every explanation Claude wrote on this server
    (local, not in git). Used if Claude fails for an input it already saw.
  * demo_responses.json   - pre-generated explanations of the fixed
    scenarios (in git), made with run_scenarios.py --save. A safety net
    for the presentation.
"""

import hashlib
import json
from pathlib import Path


def cache_key(analysis: dict, context: dict, language: str) -> str:
    payload = json.dumps(
        {"analysis": analysis, "context": context, "language": language},
        sort_keys=True, ensure_ascii=False, default=str,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class ResponseCache:
    def __init__(self, path: Path, writable: bool = True):
        self.path = path
        self.writable = writable
        try:
            self.data = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            self.data = {}

    def get(self, key: str) -> dict | None:
        return self.data.get(key)

    def put(self, key: str, value: dict) -> None:
        self.data[key] = value
        if self.writable:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(
                json.dumps(self.data, ensure_ascii=False, indent=2), encoding="utf-8"
            )
