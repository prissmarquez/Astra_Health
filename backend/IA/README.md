# AI explainer · Astra Health

Turns the ML health analysis into a short explanation for the astronaut
(summary, detail, recommendations), like the "AI analysis" panel of the app.

**The ML decides, the AI explains.** `backend/ml/health_engine.py` computes the
traffic light and the reasons. Claude only puts that result into words, using
the facts the backend read from the database (values, `exercising` flag). It is
told never to invent data, and to mention exercise only when `exercising` is true.

```
backend/IA/
├── explainer.py        explain(analysis, context) -> explanation (what FastAPI calls)
├── templates.py        fallback explanation without AI
├── cache.py            reuses explanations Claude already wrote
├── schemas.py          shape of an explanation
├── config.py           settings from .env
├── scenarios.py        4 fixed test cases + the "invented exercise" check
├── check_ai.py         is Claude working? (1 real call)
├── run_scenarios.py    runs the 4 cases live; --save creates demo_responses.json
├── try_reading.py      type your own values: real ML analysis + explanation
├── tests/              automated tests (never call Claude, cost nothing)
├── requirements.txt
└── .env.example        variable names, WITHOUT values
```

## Setup

```bash
cd backend/IA
python -m venv .venv
.venv\Scripts\activate          # Windows (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
copy .env.example .env          # then paste your key in .env
```

## Use from FastAPI

```python
from health_engine import analyze      # backend/ml
from explainer import explain          # backend/IA

analysis = analyze(history, reading, package)
context = {"exercising": reading["exercising"], "values": {...}}  # read from Supabase
result = explain(analysis, context)
```

`result` has `summary`, `detail`, `recommendations` and `source`:

| `source` | Who wrote it |
|---|---|
| `ai` | Claude, just now |
| `cache` | Claude, earlier, for this exact input (Claude failed now) |
| `demo` | Pre-generated scenario answer (`demo_responses.json`) |
| `template` | No AI: fixed sentences built from the ML result |
| `measurement_error` | A value is impossible (outside the ranges in the DB `indicators` table, e.g. 0 bpm): "Error measuring the data", no AI call |

When it is not `ai`, `fallback_reason` says why (no internet, invalid key,
no credit, timeout...). The explainer **never raises**: the app always gets an
explanation. The front-end can show "AI online / local mode" from `source`.

## How to test

| What | Command | Expected |
|---|---|---|
| Claude works | `python check_ai.py` | ✅ with model, time, tokens and cost |
| Quality of the 4 cases | `python run_scenarios.py` | 4/4 passed (exercise only mentioned when `exercising` is true) |
| Fallback without AI | set `AI_ENABLED=false`, run `python run_scenarios.py` | 4/4 passed with `source: template` |
| Wrong key | put a fake key in `.env`, run `python check_ai.py` | ❌ "invalid ANTHROPIC_API_KEY" |
| No internet | disconnect, run `python check_ai.py` | ❌ "no connection to Claude" |
| Every failure, automatically | `python -m pytest` | all pass, no credit spent |

### Try your own values

`try_reading.py` adds your reading to a simulated astronaut's history, runs the
**real ML engine** (`backend/ml/health_engine.py` + the trained model) and then
the explainer:

```bash
python try_reading.py                                              # asks for each value
python try_reading.py --temperature 38.6 --heart-rate 130 --exercising
python try_reading.py --temperature 38.6 --heart-rate 130   # same, no exercise
python try_reading.py --temperature 39 --no-ai                     # template only, free
```

Values you do not give keep the astronaut's usual value. `--astronaut user_3`
uses another history; `python try_reading.py -h` lists every option.

Before the presentation: `python check_ai.py`, then
`python run_scenarios.py --save` to refresh `demo_responses.json`.

## Model and cost

`CLAUDE_MODEL=claude-haiku-5-5` costs about $0.0002 per explanation.
To switch to Opus 5.5 change only that line to `claude-opus-5-5`.
Set a monthly spend limit in console.anthropic.com -> Limits.

The key goes in `.env` locally and in Render's "Environment" tab in the cloud.
**Never in the front-end** (anyone could read it with F12).
