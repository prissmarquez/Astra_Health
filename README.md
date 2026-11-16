# Astra Health

**Personal health monitoring for astronauts on long-duration missions.**
Built for the [NASA Space Apps Challenge 2026](https://www.spaceappschallenge.org/) · Challenge: [Create Health Monitoring Software for Astronauts on Space Missions](https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/?tab=details)

🎞️ **Demo (slides):** https://www.canva.com/design/DAHbACu7ygo/d2OBmntXdBRsDzv7sAs6Kg/edit
🔗 **Live app:** https://astrahealth.cooking - Demo account: LDR-1001, ASP-2003, ADM-0001, ASP-1001, LDR-2001, ASP-1002, ASP-1003, ASP-2002, ASP-2001 / 123456789 (PASSWORD)

📄 **Project documentation:** [Read the document on Google Docs](https://docs.google.com/document/d/1m8DkLUc9CyhrAM3Dl_T38szfGQln6zldxLg-2gMiEJ8/edit?usp=sharing)

---

## Summary

Astra Health is a web app that helps astronauts log, track and understand their own health during long missions, without depending on a connection to Earth. It brings together eight indicators: heart rate, heart rate variability (HRV), SpO₂, blood pressure, glucose, body temperature, sleep and mood. Physiological readings arrive from sensors using the official Bluetooth health profiles (simulated in this prototype); mood is measured with the PANAS questionnaire. Every reading is saved on the device first and gets a preliminary green, yellow or red status, even offline. When a connection is available, the backend compares each reading with the astronaut's own 14-day baseline, flags unusual combinations of indicators with machine learning, and an AI model explains the result in plain language. This matters because the body adapts in space: core temperature rises about 1 °C and blood pressure drops about 8–9 mmHg on long missions, so one fixed threshold for everyone confuses adaptation with illness.

---

## Features

- **Daily check-in:** measure six physiological indicators (heart rate, HRV, SpO₂, blood pressure, temperature, glucose), log exercise and sleep, and complete the PANAS mood questionnaire. A half-finished check-in is kept in the tab (sessionStorage) while the astronaut fills in PANAS.
- **Sensor emulation:** a Sensors tab sends readings to the Check-in tab using the official Bluetooth GATT formats, so a real sensor only changes the data source.
- **Offline first:** a Service Worker caches the app (network-first); readings wait in a local queue (localStorage), each tagged with the `owner_id` of the astronaut who took it, get a preliminary status on the device, and are sent to `POST /sync` automatically when the connection returns. Several astronauts can share one device without mixing their readings.
- **Traffic-light status (three layers, the most severe color wins):**
  1. **Safe ranges:** clinical thresholds (BTS, ACC/AHA, ESC/ESH, ADA, Endocrine Society) adjusted for space adaptation (expected temperature +1 °C, Stahn 2017; expected systolic pressure −8 mmHg, Norsk 2015). Sleep uses the 7-night average: under 5 h (300 min) is red; 5–6 h is shown as advisory only, because it is common in orbit (Barger 2014). When the astronaut is exercising, the resting heart-rate rule is skipped and only a temperature above 40.5 °C raises an alert.
  2. **Personal baseline:** z-score against the astronaut's last 14 days. Yellow if one indicator deviates more than 3 SD or two deviate more than 2.5 SD; red above 4.5 SD.
  3. **Anomaly detection:** Isolation Forest flags rare combinations of deviations (yellow: something odd, not a diagnosis).
  With fewer than 5 days of history the app runs in *startup mode* (safe ranges only).
- **Physiological connections:** when two indicators deviate together, the result explains the link (e.g. fever speeds up the heart; low oxygen makes the heart beat faster; sleeping little worsens mood).
- **Plain-language explanations (AI Insights):** Claude turns the latest analysis into a short summary for each body system (heart rate, HRV, SpO₂, blood pressure, temperature, glucose, sleep, mood). The AI explains alerts; it never decides them. If the AI is unavailable, a cached or template explanation is used.
- **History:** charts with recommended ranges, detailed log, live updates (Supabase Realtime) and crew comparison.
- **Roles:** crew, leader and admin, enforced by the database (Row Level Security), not only by the interface. Crew members see their own full history and only the latest value of each crewmate; the leader can open the full history of any member of their own crew; ground admins see everyone and create crews and accounts.

---

## NASA data and resources

### Challenge resources (NASA Human Research Program)

We used the challenge's NASA resources to decide what to monitor. Each indicator maps to one of the [5 Hazards of Human Spaceflight](https://www.nasa.gov/hrp/hazards/) and the related [Risks of Human Spaceflight](https://www.nasa.gov/hrp/risks/):

| Hazard | What Astra Health monitors |
| --- | --- |
| **Radiation** | Radiation dose (mGy), a manual-entry indicator in the database, shown in History |
| **Isolation and confinement** | Mood (PANAS) and sleep, linked to the HRP risk of behavioral changes |
| **Distance from Earth** | Offline-first design: readings are stored and classified on the device, with no need to wait for ground support |
| **Gravity fields** | Blood pressure and core temperature, with thresholds adjusted for adaptation to microgravity |
| **Hostile and closed environments** | SpO₂, heart rate and HRV |

### NASA Open Science Data Repository: Inspiration4

| Dataset | How we used it |
| --- | --- |
| [OSD-575](https://osdr.nasa.gov/bio/repo/data/studies/OSD-575): Inspiration4 crew blood serum (Comprehensive Metabolic Panel, LSDS-8) | Real glucose values of the 4 crew members. We use each crew member's **pre-flight baseline**, the **real pre-flight variation (SD)** and the **landing spike at R+1** to generate the glucose of our simulated astronauts (`backend/ml/data/clean_nasa.py`, `backend/ml/data/simulate_astronauts.py`). |
| [OSD-569](https://osdr.nasa.gov/bio/repo/data/studies/OSD-569): Inspiration4 crew whole blood (Complete Blood Count, LSDS-7) | Hemoglobin, hematocrit and red blood cell count are cleaned and merged by time point (`backend/ml/data/processed/nasa_i4_blood.csv`). They are not used by the model yet (see *Next steps*). |

### Space agency partner resources (CSA)

- **Astroskin** (Canadian Space Agency): the smart vest used on the ISS since 2018 is our reference sensor for heart rate, HRV, SpO₂, systolic pressure and skin temperature. Sleep comes from a sleep ring (Oura, flown on Ax-4) and glucose from a continuous glucose monitor (flown on Ax-4). Diastolic pressure has no flown Bluetooth sensor yet, so it is recorded as manual entry.
- **[Monitoring Radiation for Astronaut Health](https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp)** (CSA): basis for including radiation dose as an indicator.

### Other data

- **MMASH** (PhysioNet): 22 healthy people with heart rate, RR intervals, sleep and mood questionnaires. We use it for each simulated astronaut's personal baseline (heart rate, HRV as RMSSD, sleep, positive and negative mood) and for the real relationship between sleep and negative mood.
- **Spaceflight literature** (Stahn 2017, Norsk 2015, Barger 2014): in-flight changes in temperature, blood pressure and sleep, used both in the thresholds and in the simulation.

---

## How we validated it

There is no public dataset of daily astronaut vital signs, so we built a **simulated dataset** grounded in real data (`backend/ml/data/simulate_astronauts.py`, fixed random seed 42):

- 22 astronauts (one per MMASH participant): 9 short missions (14 flight days), 10 standard (180 days) and 3 long (365 days), each with 10 pre-flight days and 7, 14 or 21 post-flight days. **3,507 astronaut-days** in total.
- In-flight adaptation follows the literature (full adaptation after 75 days, Stahn 2017) and fades back to zero during recovery; glucose comes from Inspiration4.
- **194 problem days** were injected during flight (7 % chance per flight day): hypoxia (47), hypertension (41), insomnia (41), hypoglycemia (38) and fever (27).

Results of the last training run (`backend/ml/data/processed/ml_results.csv`, produced by `backend/ml/train_model.py`):

| Metric | Value |
| --- | --- |
| Problem days detected (recall) | **99.5 %** (193 of 194) |
| Alerts that were real problems (precision) | **21.7 %** (193 of 890 yellow/red days) |
| Normal days flagged yellow or red | 21 % (697 of 3,313) |

**Honest reading of these numbers:** recall is optimistic because the injected problems are built from the same clinical limits the app checks, and the model is evaluated on the same simulated data it was trained on (no held-out set yet). Precision is low for two reasons. The personal-baseline layer takes part in 407 of the 697 false alarms, because a 14-day window is short and a few large random swings cross 3 SD. The severe-sleep rule takes part in 236 of them (195 are caused by that rule alone): some MMASH participants recorded very short nights, so their simulated astronauts start with a sleep deficit. Reducing false alarms is our first next step.

Automated tests: 37 Python tests for the AI layer (explainer and its fallbacks, input validation, body-system mapping) and 24 Bluetooth codec tests, all passing.

---

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | HTML, CSS and vanilla JavaScript (no build step, no framework) |
| Offline | Service Worker (network-first cache), localStorage queue, sessionStorage check-in draft |
| Sensors | Bluetooth GATT codecs (IEEE-11073 SFLOAT/FLOAT), emulated between tabs with BroadcastChannel; ready for Web Bluetooth |
| API | FastAPI + Uvicorn (Python 3.13), Pydantic validation |
| Database and auth | Supabase: PostgreSQL, Auth, Row Level Security and Realtime |
| Machine learning | pandas, NumPy and scikit-learn 1.9.0 (Isolation Forest) |
| AI explanations | Claude API (Anthropic), default model `claude-haiku-5-5` |
| Deployment | Railway, Docker image (`python:3.13-slim`); one service serves the API and the frontend at https://astrahealth.cooking |

---

## Architecture

```
 Browser (frontend/)                         FastAPI (backend/main.py)                 Supabase
 ───────────────────                         ─────────────────────────                 ────────
 Check-in ──► offline queue (localStorage)
              + preliminary color (JS)
              │  when online
              └──── POST /sync ───────────► 1. validate values
                                            2. save 10 measurements ──(user token)────► measurements
                                            3. read last 14 days ─────(user token)────► daily_readings (view)
                                            4. health engine (3 layers)
                                            5. save verdict ──────────(secret key)────► health_analyses
              ◄─── colors + reasons ──────
 History / Home ──────────────── read directly with the user's token (RLS) ──────────► views, crew_latest()
 AI Insights ──── GET /body/{system} ─────► latest verdict + values ──► Claude ──► plain-language text
 Admin ────────── POST /admin/users, /admin/crews ─► checks role = admin ──────────────► Auth + profiles, crews
```

The browser only ever holds the publishable Supabase key and the user's own session token. Everything that must not be forged (the ML verdict, new accounts) is written by the backend.

---

## Backend

### API endpoints (`backend/main.py`)

All endpoints except `/health` need the user's Supabase access token in `Authorization: Bearer <token>`. Interactive docs: `/docs`.

| Method and path | Who | What it does |
| --- | --- | --- |
| `GET /health` | anyone | Liveness check used by Railway; returns the model's training date. |
| `POST /sync` | signed-in user | Uploads the offline queue (oldest first). For each reading: rejects impossible values (e.g. 0 bpm), saves its 10 measurements, analyses it against the last 14 days and stores the verdict in `health_analyses`. Safe to resend: measurement ids are derived from the reading id (UUID v5), so a repeated reading is ignored, not duplicated. One bad reading does not stop the rest. |
| `POST /analysis` | signed-in user | Preview: analyses one reading and returns the color, reasons, deviations, connections, mission phase and adaptation, **without saving anything**. Useful for testing in `/docs`. |
| `GET /body/{system}` | signed-in user | AI Insights: explains the latest saved verdict for one body system (`heart_rate`, `hrv`, `spo2`, `pressure`, `temperature`, `glucose`, `sleep`, `mood`) and returns a summary, status (stable / watch / attention), a small chart and recommendations. |
| `POST /admin/users` | admin | Creates an account (ID `ASP-xxxx` crew, `LDR-xxxx` leader, `ADM-xxxx` admin) and assigns it to a crew. Checks the crew rules (max 4 members, one leader, the leader first). Uses the secret key on the server only. |
| `POST /admin/crews` | admin | Creates a crew (`ASTRA-…`) with the admin's own token; RLS checks the role again in the database. |
| `/` | anyone | Serves the `frontend/` folder as static files (mounted last, so API routes win). |

### Health engine (`backend/ml/`)

| File | Purpose |
| --- | --- |
| `data/explore_mmash.py`, `data/explore_nasa.py` | First look at the raw datasets |
| `data/clean_mmash.py` | MMASH → one baseline per participant (`mmash_summary.csv`) |
| `data/clean_nasa.py` | Inspiration4 OSD-575 / OSD-569 → glucose and blood count by time point (`nasa_i4_blood.csv`) |
| `data/simulate_astronauts.py` | 22 simulated missions with phases, adaptation and injected problems (`astronaut_dataset_ml.csv`) |
| `health_engine.py` | `clinical()` (layer 1), `compute_z()` (layer 2), `explain()` (deviations and connections), `analyze()` (what the API calls) |
| `train_model.py` | Trains the Isolation Forest (200 trees, contamination 3 %, normal days only), evaluates the three layers, saves `isolation_forest_model.pkl` and `ml_results.csv` |

Mission phase and adaptation are computed by the backend from the mission data in the database: pre-flight 0; in flight `min(day / 75, 1)`; after landing it fades back to 0 over the recovery days. The browser's preliminary color uses adaptation 0, so it can differ from the server's final color during flight.

### AI explainer (`backend/IA/`)

**The ML decides, the AI explains.** `explainer.py` sends Claude only the verdict (color, reasons, deviations) and the measured values with the exercise flag. Claude is told never to invent data and to mention exercise only when the astronaut marked it. Fallback chain, so an explanation is always returned: Claude → cache of explanations already written → demo scenarios → template (`templates.py`). Impossible values are reported as measurement errors, never hidden. `body_systems.py` maps each body system to its indicators and status.

### Database (`backend/DataBase/`)

Supabase PostgreSQL, built by 15 SQL migrations in `backend/DataBase/migrations/` (run in order).

| Object | Type | Purpose |
| --- | --- | --- |
| `profiles` | table | One row per account: name, `astronaut_code`, role (`crew` / `leader` / `admin`), `crew_id` |
| `crews` | table | Crews (`ASTRA-…`), max 4 members and one leader |
| `missions`, `mission_types`, `mission_participants` | tables | Mission dates and type (`short` 14+7 days, `standard` 180+14, `long` 365+21) |
| `indicators`, `sensors`, `sensor_indicators` | catalogs | Valid ranges and units per indicator (including `radiation_dose`), and which sensor measures what |
| `measurements` | table | One row per indicator per reading, with `is_simulated` and `exercising` |
| `health_analyses` | table | Stored verdicts: color, mode (`startup` / `personal`), reasons, deviations, connections, `detected_by_ml`, model version. **Written only by the backend** (migration 013), so a user cannot forge a green result |
| `daily_readings`, `readings_detailed` | views | One row per astronaut per day / per measurement, with phase and adaptation |
| `crew_overview`, `unassigned_astronauts` | views | Admin panel |
| `crew_latest()` | function | Latest value of each crewmate (what crew members are allowed to see) |

Row Level Security on every table: each astronaut reads and inserts their own data; crewmates see each other's profile and latest values; the leader reads the full history and verdicts of their own crew; admins read everything. Realtime is enabled on `measurements` and `health_analyses`.

### Environment variables

One file for the whole backend: `backend/.env` (copy `backend/.env.example`; it is in `.gitignore`). On Railway, the same names go in the service's *Variables* tab.

| Variable | Required | Where it may go |
| --- | --- | --- |
| `SUPABASE_URL` | yes | server and frontend |
| `SUPABASE_PUBLISHABLE_KEY` | yes | server and frontend |
| `SUPABASE_SECRET_KEY` | yes (saving verdicts, admin endpoints) | **server only** |
| `ANTHROPIC_API_KEY` | no (without it: template explanations) | **server only** |
| `CLAUDE_MODEL`, `AI_ENABLED`, `AI_TIMEOUT` | no (defaults: `claude-haiku-5-5`, `true`, 15 s) | server only |
| `ALLOWED_ORIGINS` | no (unset = `*`; same-origin in production) | server only |
| `TEST_EMAIL`, `TEST_PASSWORD` | no (only `DataBase/check_connection.py`) | local only, never in production |

### Deployment (Railway)

- `Dockerfile` at the repo root: `python:3.13-slim`, installs `backend/requirements.txt`, runs `uvicorn main:app --host 0.0.0.0 --port $PORT` from `backend/`.
- `railway.json`: `DOCKERFILE` builder, healthcheck on `/health`.
- `.dockerignore` keeps `.env` files, `__pycache__`, `.DS_Store` and the raw datasets out of the image.
- Custom domain: https://astrahealth.cooking (registered with Porkbun, pointed to the Railway service).

---

## Project structure

```
Astra_Health/
├── frontend/
│   ├── index.html         # Redirects to pages/index.html (login)
│   ├── sw.js              # Service Worker (offline cache)
│   ├── pages/             # One HTML file per screen
│   ├── services/          # JavaScript: Supabase client, guards, page logic, BLE codec (+ test)
│   ├── style/             # CSS
│   └── assets/            # Images
├── backend/
│   ├── main.py            # FastAPI app: /health, /sync, /analysis, /body/{system}, /admin/users, /admin/crews + static frontend
│   ├── requirements.txt   # Everything the API needs at runtime
│   ├── .env.example       # Template for backend/.env
│   ├── DataBase/          # Supabase connection, helpers and SQL migrations 001–015 (tables, views, RLS)
│   ├── ml/                # Health engine, data cleaning, simulation, model training, trained model, raw + processed data
│   └── IA/                # Plain-language explanations with Claude (+ tests)
├── Dockerfile             # Production image
├── .dockerignore
├── railway.json           # Deployment settings
├── requirements.txt       # Points to backend/requirements.txt
└── .python-version        # 3.13
```

### Frontend pages

The frontend is plain HTML, CSS and JavaScript, with no build step and no framework. Pages are in `frontend/pages/`, scripts in `frontend/services/`, styles in `frontend/style/`.

| Page | Files |
| --- | --- |
| Log in | `index.html`, `script_login.js`, `style_login.css` |
| Home | `principal_page.html`, `principal_page.js` |
| Daily check-in | `checkin.html`, `checkin.js`, `checkin.css` |
| PANAS questionnaire | `panas.html`, `panas.js`, `panas.css` |
| Sensors | `sensors.html`, `sensors.js`, `sensors.css` |
| History (crew and leader) | `historical.html`, `script_historical.js`, `historial.css` |
| AI Insights | `BodyAi.html`, `script_BodyAi.js`, `BodyAi_style.css` |
| Admin: crews and accounts | `admi.html`, `admi.js`, `admi.css` |
| Admin: astronaut history | `history_admi.html`, `script_admi.js`, `historial.css`, `admi.css` |
| Crew registration (prototype, sample data) | `ast_checkin.html`, `script_astroin.js` |

### Shared frontend files

| File | Purpose |
| --- | --- |
| `style/styles.css` | Shared look: header, cards, navigation |
| `services/supabase_client.js` | Supabase session, cached profile, logout, connection status, offline queue, API address, Service Worker registration |
| `services/auth_guard.js` | Role checks (crew, leader, admin) |
| `services/nav.js` | Navigation between pages |
| `services/ble_codec.js` | Bluetooth GATT encode/decode for each sensor |
| `sw.js` | Service Worker for offline use |

---

## Run it locally

**1. Backend + frontend**

```bash
cd backend
python3 -m pip install -r requirements.txt
cp .env.example .env        # then fill in your own keys
python3 -m uvicorn main:app --reload
```

Open http://localhost:8000. FastAPI serves the frontend too (API docs at http://localhost:8000/docs). (Alternative: open `frontend/index.html` with the VS Code **Live Server** extension on port 5500; it will call the API on port 8000.) Do not open the files by double-clicking them: the Service Worker and the session need `http://localhost`.

**Or with Docker** (same image as production):

```bash
docker build -t astra-health .
docker run --env-file backend/.env -e PORT=8080 -p 8080:8080 astra-health
```

**2. Try the sensors**

Open **Sensors** in one tab and **Check-in** in another. Press *Send reading* in Sensors, then *Measure* in Check-in.

**3. Retrain the model (optional)**

```bash
cd backend/ml
python3 data/clean_mmash.py          # optional: rebuilds data/processed/ from data/raw/
python3 data/clean_nasa.py           # optional
python3 data/simulate_astronauts.py
python3 train_model.py
```

The raw MMASH and Inspiration4 files are in `backend/ml/data/raw/` (they are left out of the Docker image). Keep scikit-learn at 1.9.0: the saved model may not load with another version.

**4. Run the tests**

```bash
cd backend
python3 -m pip install -r requirements.txt pytest
cd IA
python3 -m pytest
cd ../../frontend/services
node ble_codec.test.js
```

> Secret keys (`SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`) live only in `backend/.env` (or Railway's variables) and are never sent to the frontend. Without `ANTHROPIC_API_KEY` the app still works with template explanations.

---

## Limitations

- Sensors are **simulated** in this prototype; readings are marked `is_simulated: true`.
- The model was trained and evaluated on **simulated data** grounded in MMASH and Inspiration4, not on real astronaut time series, and without a held-out set. Precision is still low (see *How we validated it*).
- The traffic-light ranges come from clinical guidelines and spaceflight studies, but they are **not validated clinical criteria** for astronauts.
- The preliminary color shown offline uses Earth thresholds (no adaptation); the final color comes from the server.
- Radiation dose is stored and shown in History, but the check-in does not ask for it yet.
- Astra Health does **not** diagnose or replace a flight surgeon. PANAS measures mood, not mental disorders.
- Web Bluetooth only works in Chrome and Edge.

## Next steps

- Reduce false alarms (longer or robust personal baseline, sleep baseline, personal thresholds) and evaluate on a held-out set.
- Use the Inspiration4 blood count data (hemoglobin, hematocrit) to monitor space anemia.
- Connect a real Bluetooth sensor through Web Bluetooth.
- Add radiation dose to the check-in and connect crew registration to `POST /admin/users`.


## References

American Diabetes Association Professional Practice Committee. (2025). 6. Glycemic goals and hypoglycemia: Standards of care in diabetes—2025. *Diabetes Care, 48*(Suppl. 1), S128–S145. https://doi.org/10.2337/dc25-S006

Anthropic. (2026a). *Claude* [Large language model]. https://claude.ai

Anthropic. (2026b). *Claude Code* [AI coding assistant]. https://claude.com/claude-code

Barger, L. K., Flynn-Evans, E. E., Kubey, A., Walsh, L., Ronda, J. M., Wang, W., Wright, K. P., & Czeisler, C. A. (2014). Prevalence of sleep deficiency and use of hypnotic drugs in astronauts before, during, and after spaceflight: An observational study. *The Lancet Neurology, 13*(9), 904–912. https://doi.org/10.1016/S1474-4422(14)70122-X

Canadian Space Agency. (n.d.). *Astroskin*. https://www.asc-csa.gc.ca/eng/sciences/astroskin.asp

Canadian Space Agency. (2026, February 26). *Monitoring radiation for astronaut health*. https://www.asc-csa.gc.ca/eng/news/articles/2026/2026-02-26-monitoring-radiation-astronaut-health.asp

Cryer, P. E., Axelrod, L., Grossman, A. B., Heller, S. R., Montori, V. M., Seaquist, E. R., & Service, F. J. (2009). Evaluation and management of adult hypoglycemic disorders: An Endocrine Society clinical practice guideline. *The Journal of Clinical Endocrinology & Metabolism, 94*(3), 709–728. https://doi.org/10.1210/jc.2008-1410

Gaskill, M. L. (2024, August 15). *Mental well-being in space*. NASA. https://www.nasa.gov/missions/station/iss-research/mental-well-being-in-space/

Google. (2026). *Gemini* [Large language model]. https://gemini.google.com

ISS National Laboratory. (2025, June 3). *New space-based research may pave the way for first astronaut with diabetes*. https://issnationallab.org/press-releases/ax4-suite-ride-diabetes-research/

Liu, F. T., Ting, K. M., & Zhou, Z.-H. (2008). Isolation forest. In *2008 Eighth IEEE International Conference on Data Mining* (pp. 413–422). IEEE. https://doi.org/10.1109/ICDM.2008.17

NASA Human Research Program. (n.d.-a). *5 hazards of human spaceflight*. NASA. https://www.nasa.gov/hrp/hazards/

NASA Human Research Program. (n.d.-b). *Ongoing HRP research in space*. NASA. https://www.nasa.gov/hrp/ongoing-hrp-research/

NASA Human Research Program. (n.d.-c). *Risks of human spaceflight*. NASA. https://www.nasa.gov/hrp/risks/

NASA Human Research Program. (2024, October 22). *Risk of behavioral changes and psychiatric disorders*. NASA. https://www.nasa.gov/reference/risk-of-behavioral-changes-and-psychiatric-disorders/

NASA Office of the Chief Health and Medical Officer. (2023). *Sleep accommodations* (OCHMO-TB-041, Rev. B). NASA. https://www.nasa.gov/wp-content/uploads/2023/12/ochmo-tb-041-sleep-accommodations.pdf

NASA Open Science Data Repository. (n.d.-a). *OSD-569: Inspiration4 crew whole blood* [Data set]. https://osdr.nasa.gov/bio/repo/data/studies/OSD-569

NASA Open Science Data Repository. (n.d.-b). *OSD-575: Inspiration4 crew blood serum* [Data set]. https://osdr.nasa.gov/bio/repo/data/studies/OSD-575

NASA Space Apps Challenge. (2026). *Create health monitoring software for astronauts on space missions* [Challenge]. https://www.spaceappschallenge.org/2026/challenges/health-monitoring-software/?tab=details

Norsk, P., Asmar, A., Damgaard, M., & Christensen, N. J. (2015). Fluid shifts, vasodilatation and ambulatory blood pressure reduction during long duration spaceflight. *The Journal of Physiology, 593*(3), 573–584. https://doi.org/10.1113/jphysiol.2014.284869

O'Driscoll, B. R., Howard, L. S., Earis, J., & Mak, V. (2017). BTS guideline for oxygen use in adults in healthcare and emergency settings. *Thorax, 72*(Suppl. 1), ii1–ii90. https://doi.org/10.1136/thoraxjnl-2016-209729

Rossi, A., Da Pozzo, E., Menicagli, D., Tremolanti, C., Priami, C., Sirbu, A., Clifton, D., Martini, C., & Morelli, D. (2020). *Multilevel Monitoring of Activity and Sleep in Healthy People* (version 1.0.0) [Data set]. PhysioNet. https://doi.org/10.13026/cerq-fc86

Stahn, A. C., Werner, A., Opatz, O., Maggioni, M. A., Steinach, M., von Ahlefeld, V. W., Moore, A., Crucian, B. E., Smith, S. M., Zwart, S. R., Schlabs, T., Mendt, S., Trippel, T., Koralewski, E., Koch, J., Choukèr, A., Reitz, G., Shang, P., Röcker, L., . . . Gunga, H.-C. (2017). Increased core body temperature in astronauts during long-duration space missions. *Scientific Reports, 7*, Article 16180. https://doi.org/10.1038/s41598-017-15560-w

Watson, D., Clark, L. A., & Tellegen, A. (1988). Development and validation of brief measures of positive and negative affect: The PANAS scales. *Journal of Personality and Social Psychology, 54*(6), 1063–1070. https://doi.org/10.1037/0022-3514.54.6.1063

Welch, J. D. (2024, September 10). *Inspiration4 mission: Commercial astronaut data now available on OSDR!* NASA. https://www.nasa.gov/osdr-latest-news-i4-mission-datasets/

Whelton, P. K., Carey, R. M., Aronow, W. S., Casey, D. E., Jr., Collins, K. J., Dennison Himmelfarb, C., DePalma, S. M., Gidding, S., Jamerson, K. A., Jones, D. W., MacLaughlin, E. J., Muntner, P., Ovbiagele, B., Smith, S. C., Jr., Spencer, C. C., Stafford, R. S., Taler, S. J., Thomas, R. J., Williams, K. A., Sr., . . . Wright, J. T., Jr. (2018). 2017 ACC/AHA/AAPA/ABC/ACPM/AGS/APhA/ASH/ASPC/NMA/PCNA guideline for the prevention, detection, evaluation, and management of high blood pressure in adults. *Hypertension, 71*(6), e13–e115. https://doi.org/10.1161/HYP.0000000000000065

Williams, B., Mancia, G., Spiering, W., Agabiti Rosei, E., Azizi, M., Burnier, M., Clement, D. L., Coca, A., de Simone, G., Dominiczak, A., Kahan, T., Kerins, M., Kjeldsen, S., Kreutz, R., Laurent, S., Lip, G. Y. H., McManus, R., Narkiewicz, K., Ruschitzka, F., . . . Desormais, I. (2018). 2018 ESC/ESH guidelines for the management of arterial hypertension. *European Heart Journal, 39*(33), 3021–3104. https://doi.org/10.1093/eurheartj/ehy339

---

## Team

| Name | Role |
| --- | --- |
| Marla Elizabeth | Frontend |
| Danae | Frontend, Sensors |
| Gael | AI and database |
| Priscila | API and machine learning, offline mode |
