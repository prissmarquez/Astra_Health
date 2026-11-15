# Database · Astra Health (Supabase)

Owner: Back-end 1. The whole team uses **a single Supabase project**.

```
backend/DataBase/
├── migrations/
│   ├── 001_initial_schema.sql   tables, views, types and validation
│   ├── 002_rls_security.sql     permissions (RLS, admin)
│   ├── 003_catalogs.sql         mission types, indicators, sensors
│   ├── 004_lock_trigger_functions.sql   hides trigger functions from the API
│   ├── 005_crews.sql            crews: one crew per astronaut
│   ├── 006_leader_role.sql      adds the 'leader' role
│   ├── 007_crew_limits_and_leader.sql   4-member limit, leader rules, crew visibility, realtime
│   ├── 008_exercising_flag.sql  exercising flag on measurements (used by the ML)
│   ├── 009_rename_indicators_to_ml.sql  indicator codes renamed to the ML names
│   └── 010_health_analyses.sql  stored ML results (traffic light, reasons) per analysis
├── connection.py                Supabase client (publishable key + user token)
├── measurements.py              functions for Backend 2
├── check_connection.py          connection and security check
├── requirements.txt
├── .env.example                 variable names, WITHOUT values
└── .gitignore                   keeps .env and .venv out of git
```

## Essentials and where they live

| Essential | Column | Where |
|---|---|---|
| Name / Id | `astronaut`, `astronaut_id` | `profiles` (shown in the views) |
| Indicator | `indicator` | `measurements` |
| Sensor | `sensor_id`, `sensor_name` | `measurements` / `sensors` |
| Value | `value` (+ `unit`) | `measurements` |
| Mission type | `mission_type`: `short` / `standard` / `long` | `missions` |
| Phase | `phase`: `pre_flight` / `flight` / `post_flight` | computed in the views |
| Date / Time | `taken_date`, `taken_time` (UTC) — full value in `taken_at` | `measurements` |
| Mission day | `mission_day` (0 = launch day, negative = pre-flight) | computed in the views |
| Adaptation (0-1) | `adaptation` | `daily_adaptation` |
| Crew | `crew_id` (short code, e.g. `ASTRA-A`) | `profiles` (current) and `measurements` (at the time) |
| Exercising | `exercising` (true / false, default false) | `measurements` |

## Data model

| Table | Contents |
|---|---|
| `auth.users` | Users and passwords. Managed by Supabase Auth; we don't touch it. |
| `profiles` | One per user (created automatically on sign-up). `name`, `role` (`crew`, `leader` or `admin`) and `crew_id`. |
| `crews` | One per crew. Its `id` is a short readable code such as `ASTRA-A`. |
| `mission_types` | `short` (14 flight days), `standard` (180), `long` (365). Pre-flight: 10 days. Post-flight: 7 / 14 / 21 days. |
| `missions` | Name, type, launch. **The planned return is computed automatically**; `actual_return_at` is filled in on return. |
| `mission_participants` | Which astronauts take part in each mission (managed by the admin). |
| `indicators` | Fixed list, each with a single unit, a data-entry range and its usual `entry_method`. |
| `sensors` | Astroskin, Oura Ring, continuous glucose monitor, mood questionnaire, manual entry and the simulator, each with where it has flown. |
| `sensor_indicators` | Which indicator each sensor measures and with what method. |
| `measurements` | One row per indicator: sensor, value, status, date and time, source, `exercising`. **The mission is assigned automatically** from the date. `exercising = true` means the reading was taken during or right after exercise; the ML then uses its exercise ranges (a high temperature or heart rate is expected and is not compared with the resting baseline). |
| `daily_adaptation` | Adaptation score 0-1 per astronaut per day. Written only by the backend/ML process. |
| `health_analyses` | One row per ML analysis (`/analysis`): `traffic_light` (`green` / `yellow` / `red`), `mode` (`startup` / `personal`), `clinical_reasons`, `deviations`, `connections`, `detected_by_ml`, `model_version`, `analyzed_at`. The `id` is the reading's id, so a resend is never duplicated. **Insert only** (medical record). Read: own; the leader also reads analyses taken in their crew; the admin (ground medical team) reads all. Realtime enabled. |

**Views** (virtual tables built from the data above; they respect RLS):

| View | Contents |
|---|---|
| `readings_detailed` | One row per measurement with every essential: astronaut, indicator, sensor, value, unit, mission type, phase, date, time, mission day, adaptation. This is the **full history**. |
| `daily_readings` | **One row per astronaut per day** with the **latest** value of each indicator as a column (`heart_rate`, `hrv`, `spo2`, `systolic_pressure`, `diastolic_pressure`, `temperature`, `glucose`, `sleep_min`, `positive_mood`, `negative_mood`, `radiation_dose`) plus mission, phase, mission day and adaptation. `exercising` is the flag of the day's latest temperature, heart rate or HRV reading. |

**Indicators**

| Code | Unit | Entry |
|---|---|---|
| `heart_rate` | bpm | bluetooth |
| `hrv` | ms | bluetooth (Astroskin) |
| `spo2` | % | bluetooth |
| `systolic_pressure` / `diastolic_pressure` | mmHg | bluetooth |
| `temperature` | °C | bluetooth |
| `glucose` | mg/dL | bluetooth |
| `sleep_min` | minutes | calculated (or typed in) |
| `positive_mood` / `negative_mood` | 10 to 50 | questionnaire |
| `radiation_dose` | mGy | manual |

**Phase rules** (with the mission's dates):
- `pre_flight`: from 10 days before launch until launch.
- `flight`: from launch until the return (actual if known, otherwise planned).
- `post_flight`: after the return, for 7 / 14 / 21 days depending on the mission type.
- A measurement outside every mission window is accepted, with no mission and no phase.

**Rules enforced by the database (independent of the code):**
- The sensor must measure that indicator.
- The value must fall within the indicator's range. Ranges only catch data-entry errors: **they are not clinical thresholds**.
- Measurements are **never edited or deleted**, not even by the admin. To measure again, insert a new row with `repeats_id` = id of the original, same user and indicator.

## Roles

| | Crew | Leader | Admin (ground) | Backend/ML process |
|---|---|---|---|---|
| See their own data (full history) | ✅ | ✅ | ✅ | ✅ |
| See crewmates' names | ✅ | ✅ | ✅ | ✅ |
| See crewmates' **latest** value of the selected indicator + latest adaptation (`crew_latest`) | ✅ | ✅ | ✅ | ✅ |
| See the crew's **full history** (live with Realtime) and adaptation history | ❌ | ✅ | ✅ | ✅ |
| See other crews | ❌ | ❌ | ✅ | ✅ |
| Record measurements | own only | own only | own only | ✅ |
| Create crews and missions, move people, choose leaders | ❌ | ❌ | ✅ | ✅ |
| Write adaptation | ❌ | ❌ | ❌ | ✅ |
| Edit or delete measurements | ❌ | ❌ | ❌ | (admin tasks only) |

Nobody can make themselves admin from the app. To promote a user, Back-end 1 runs in the SQL Editor:

```sql
update public.profiles set role = 'admin' where id = '<user id from Authentication>';
```

## Crews

- Each astronaut belongs to **one crew at a time** (`profiles.crew_id`). The crew id is a short code such as `ASTRA-A`.
- **At most 4 members per crew and 4 participants per mission.** The 5th is rejected.
- **Every crew with members has exactly one leader.** The first person to join an empty crew becomes its leader. The admin transfers leadership with `set_crew_leader`. A leader cannot leave (or be removed) while other members remain: transfer leadership first. A mission can only be assigned to a crew that has a leader.
- **Ground admins cannot join a crew.**
- **Sign-up and joining a crew happen outside the database.** The external process sets `profiles.crew_id` with the secret key, or an admin calls `set_user_crew(user_id, crew_id)`. Astronauts cannot change their own crew or role.
- Every measurement stores the crew the astronaut had **when it was taken** (`measurements.crew_id`), so history does not move if someone changes crew. The leader sees the measurements taken in their crew.
- A mission can be assigned to a crew (`missions.crew_id`): all its members become participants automatically, and so does anyone who joins that crew before the mission ends. Past participations are kept.
- **Realtime** is enabled on `measurements`: the front-end can subscribe to new readings and Supabase only delivers the rows each user is allowed to see.

## Setup

### Back-end 1

1. Apply `001` to `007`, in order, once (SQL Editor or the Supabase connector).
2. **Authentication → Users → Add user**: create a test user (tick *Auto Confirm User*).
3. Copy `.env.example` to `.env` in this folder and fill it in.
4. Install and check:

```bash
cd backend/DataBase
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python check_connection.py
```

### For Backend 2

The front-end sends `Authorization: Bearer <access_token>` on every request. The backend passes that token to the functions in `measurements.py`:

| Function | Use |
|---|---|
| `save_measurements(token, rows)` | Saves a batch (offline queue). Resending the same `id` never duplicates. |
| `save_measurement(token, measurement)` | A single one. Returns `None` if it already existed. |
| `repeat_measurement(token, original_id, sensor_id, value, taken_at, source)` | New reading linked to the original. |
| `list_measurements(token, indicator=, mission_type=, phase=, astronaut_id=, crew_id=, since=, until=)` | Full history (`readings_detailed`). |
| `list_daily_readings(token, astronaut_id=, crew_id=, mission_type=, phase=, since=, until=)` | One row per day (`daily_readings`). |
| `set_user_crew(token, user_id, crew_id)` | Admin only: moves an astronaut to a crew. |
| `set_crew_leader(token, user_id)` | Admin only: makes someone the leader of their crew. |
| `crew_latest(token, indicator=)` | Any crew member: latest value of that indicator for each crewmate, plus their latest adaptation. |
| `new_measurement(...)` | Builds a dict with a new UUID. |

Do not send `user_id` or `received_at`: the database sets them from the token. The mission, phase and mission day are filled in automatically.

The adaptation score is written with the **secret key** from a server-side process only (`daily_adaptation`, one row per astronaut per day).

### For Frontend

- Public variables: the project URL and the **publishable** key (Back-end 1 shares them).
- Sign-up and sign-in with `@supabase/supabase-js` ([official guide](https://supabase.com/docs/guides/auth/quickstarts/react)). Send the name in `signUp({ email, password, options: { data: { name } } })`; the profile is created automatically as `crew`.
- When calling the backend: `Authorization: Bearer ${session.access_token}`.
- Filters: the front-end draws the controls (indicator, mission type, phase, dates) and sends the choices; the filtering itself happens in the database query. Small catalogs (indicators, mission types) can be filtered in the browser.
- Clicking a day in `daily_readings` opens its full history from `readings_detailed`.
- Clicking an indicator: crew members call `crew_latest(indicator)` to see each crewmate's latest value; leaders and admins can also open the crew's history from `readings_detailed`.
- Each measurement is created on the device with `crypto.randomUUID()` as its `id` (see offline mode).

## Privacy: keeping everyone else out of the database

There are four layers; `.gitignore` is only one of them.

1. **`.env` + `.gitignore` (keys never reach GitHub).**
   `.env` only lives on your computer. `.gitignore` is the list of files Git ignores; since it includes `.env`, it never gets committed. The repo only has `.env.example` (names, no values). To check: `git status` must not list `.env`, and `git check-ignore -v backend/DataBase/.env` must print the rule that ignores it.
   If a key is ever committed by mistake, deleting it is not enough (it stays in git history): **rotate it** in Supabase → Project Settings → API Keys.

2. **Two keys with different powers.**
   - *Publishable* (`sb_publishable_…` / `anon`): may be used in the front-end. On its own it grants nothing RLS does not allow.
   - *Secret* (`sb_secret_…` / `service_role`): **bypasses RLS**. Server-side only (e.g. the adaptation job). Never in the front-end, on GitHub or in a chat.

3. **RLS: the real protection.** Even with the URL and the publishable key, without a session no table is visible; crew see only their own data; only admins see everyone's.

4. **Project settings (Back-end 1, in the dashboard).**
   - *Automatically expose new tables*: **off** (every permission is granted explicitly in `002`).
   - *Automatic RLS*: **on**.
   - Database → Settings → *Network Restrictions*: restrict direct Postgres connections to known IPs.
   - Authentication → Sign In / Providers: keep only the sign-up methods in use.
   - The GitHub repository must be **private**.

## Offline mode

Goal: record measurements without a network (e.g. in orbit) and upload them later **without losing or duplicating** any.

1. **Created on the device.** Each measurement gets its `id` (UUID) and `taken_at` when it is taken, not when it is uploaded.
2. **Local queue.** It is stored on the device (IndexedDB on web, SQLite on mobile) with a local `pending` state. The app shows it immediately, even offline.
3. **Sync.** When the connection returns, the app refreshes its session (Supabase does this with the refresh token) and sends the queue in batches to the backend, which calls `save_measurements`.
4. **No duplicates.** The database runs `insert … on conflict (id) do nothing`: if a batch is resent because the response was lost, repeated rows are ignored.
5. **Acknowledgement.** When the server answers successfully, the app marks those rows as `synced` (or removes them from the queue). On failure they stay pending and are retried later.
6. **No edit conflicts.** Measurements are never modified, so two devices cannot overwrite each other. A repeat may arrive before its original within the same batch: the database validates it at the end of the transaction.
7. **Two clocks.** `taken_at` is the device time; `received_at` is set by the server on arrival. The mission and phase are assigned from `taken_at`, so late uploads still land in the right phase.

To agree with Frontend: the session token expires; if the device spends a long time offline, it must refresh the session before uploading the queue (measurements remain stored locally).

## Sensors

| Indicator | Sensor | Where it flew |
|---|---|---|
| Heart rate + HRV | Astroskin (Canadian Space Agency vest) | ISS, since 2018 |
| SpO2 | Astroskin (forehead sensor) | ISS, since 2018 |
| Systolic pressure | Astroskin (estimated, no cuff) | ISS, since 2018 |
| Temperature | Astroskin (skin temperature) | ISS, since 2018 |
| Sleep | Oura Ring | Axiom Ax-4, 2025 |
| Glucose | Continuous glucose monitor (CGM) | Axiom Ax-4, 2025 (diabetes study) |
| Mood | Text questionnaire | — |
| Diastolic pressure | Manual entry (no sensor chosen yet) | — |
| Radiation dose | Manual entry | — |

`manual_entry` and `orbit_health_simulator` can record any indicator.

References:
- Astroskin (CSA): https://www.asc-csa.gc.ca/eng/sciences/astroskin.asp
- Oura Ring on Ax-4 (ISS National Lab): https://issnationallab.org/?p=48894
- CGM on Ax-4, Suite Ride study (Axiom Space): https://axiomspace.com/release/suite-ride-research-unlocks-potential-for-first-astronaut-with-diabetes
