import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import joblib
import pandas as pd
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import AwareDatetime, BaseModel, Field, field_validator

# ml/, DataBase/ and IA/ are plain script folders, so we add them to the import path
BACKEND = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND / "ml"))
sys.path.insert(0, str(BACKEND / "DataBase"))
sys.path.insert(0, str(BACKEND / "IA"))

from connection import admin_client, public_client, service_client, user_client  # noqa: E402
from health_engine import IND, WINDOW, analyze  # noqa: E402
from measurements import create_crew, list_daily_readings, save_measurements  # noqa: E402
from body_systems import SYSTEMS, focus, focused, system_metric, system_status, updated_ago  # noqa: E402
from explainer import explain  # noqa: E402
from validation import error_message, out_of_range  # noqa: E402

# DB column names -> names the model was trained with (only the ones that differ)
DB_TO_ML = {
    "systolic_bp": "systolic_pressure",
    "diastolic_bp": "diastolic_pressure",
    "mood_positive": "positive_mood",
    "mood_negative": "negative_mood",
}
# Model names -> indicator codes in the DB (used when saving measurements)
ML_TO_DB = {ml: db for db, ml in DB_TO_ML.items()}

# Which sensor and entry method records each indicator
# (sensor_indicators in DataBase/migrations/003_catalogs.sql)
SENSOR_FOR = {
    "heart_rate": ("astroskin", "bluetooth"),
    "hrv": ("astroskin", "bluetooth"),
    "spo2": ("astroskin", "bluetooth"),
    "systolic_pressure": ("astroskin", "bluetooth"),
    "temperature": ("astroskin", "bluetooth"),
    "sleep_min": ("oura_ring", "calculated"),
    "glucose": ("continuous_glucose_monitor", "bluetooth"),
    "positive_mood": ("mood_questionnaire", "questionnaire"),
    "negative_mood": ("mood_questionnaire", "questionnaire"),
    "diastolic_pressure": ("manual_entry", "manual"),  # no flown BLE sensor yet
}

ADAPTATION_DAYS = 75  # Stahn 2017, same as simulate_astronauts.py
# Fallback copy of mission_types (003_catalogs.sql): (flight_days, post_flight_days)
DEFAULT_MISSION_TYPES = {"short": (14, 7), "standard": (180, 14), "long": (365, 21)}

app = FastAPI(title="Astra Health API")

# CORS: lets the HTML front-end call this server. Token goes in a header (no cookies).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],  # GET: /health, /body
    allow_headers=["Authorization", "Content-Type"],
)

bearer = HTTPBearer(auto_error=False)

MODEL_PACKAGE = joblib.load(BACKEND / "ml" / "isolation_forest_model.pkl")
MODEL_VERSION = str(MODEL_PACKAGE.get("trained", "unknown"))


# ---------- Request / response shapes ----------------------------------------


class Vitals(BaseModel):
    heart_rate: float = Field(..., examples=[68])
    hrv: float = Field(..., examples=[55])
    sleep_min: float = Field(..., examples=[420])
    positive_mood: float = Field(..., examples=[32])
    negative_mood: float = Field(..., examples=[14])
    glucose: float = Field(..., examples=[85])
    systolic_pressure: float = Field(..., examples=[115])
    diastolic_pressure: float = Field(..., examples=[75])
    temperature: float = Field(..., examples=[36.8])
    spo2: float = Field(..., examples=[98])
    exercising: bool = False
    # Optional overrides for testing when there is no mission in the DB
    phase: Literal["pre_flight", "flight", "post_flight"] | None = None
    mission_day: int | None = None  # 0 = launch day, negative = pre-flight
    mission_type: Literal["short", "standard", "long"] | None = None


class Reading(Vitals):
    """POST /analysis: preview only, nothing is saved."""

    day: date | None = None  # empty = today (UTC)
    astronaut_id: str | None = None  # empty = the token's owner


class OfflineReading(Vitals):
    """POST /sync: a reading stored in the browser while offline."""

    id: uuid.UUID  # crypto.randomUUID() on the device
    taken_at: AwareDatetime  # device clock with time zone, e.g. "2026-11-15T06:00:00Z"
    is_simulated: bool = False  # true = test data (saved with the simulator sensor)


class AnalysisResult(BaseModel):
    traffic_light: Literal["green", "yellow", "red"]
    mode: str
    clinical_reasons: list[str]
    deviations: list[str]
    connections: list[str]
    detected_by_ml: bool
    astronaut_id: str
    day: date
    phase: str | None
    mission_day: int | None
    adaptation: float
    history_days: int


class SyncItem(BaseModel):
    id: uuid.UUID
    ok: bool
    new_measurements: int = 0  # 0 when the reading had already been uploaded
    analysis: AnalysisResult | None = None
    error: str | None = None  # the front-end keeps this reading pending



class NewUser(BaseModel):
    """POST /admin/users: a new account created by a ground admin."""

    code: str = Field(..., pattern=r"^(ASP|LDR|ADM)-[0-9]{4}$", examples=["ASP-1004"])
    name: str = Field(..., min_length=1, max_length=120, examples=["Astronaut 1004"])
    password: str = Field(..., min_length=8, max_length=72)
    role: Literal["crew", "leader", "admin"]  # values of the user_role enum (001 + 006)
    crew_id: str | None = Field(None, pattern=r"^[A-Z0-9][A-Z0-9-]{1,19}$", examples=["ASTRA-A"])

    @field_validator("code", "crew_id", mode="before")
    @classmethod
    def normalize_code(cls, value):
        if isinstance(value, str):
            value = value.strip().upper()
            return value or None
        return value

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class CreatedUser(BaseModel):
    id: str
    name: str
    astronaut_code: str
    role: str
    crew_id: str | None = None


class NewCrew(BaseModel):
    """POST /admin/crews: a new crew created by a ground admin."""

    # ASTRA- + 1 to 14 capitals or digits (migration 015)
    id: str = Field(..., pattern=r"^ASTRA-[A-Z0-9]{1,14}$", examples=["ASTRA-B"])
    name: str = Field(..., min_length=1, max_length=120, examples=["Astra Crew B"])

    @field_validator("id", mode="before")
    @classmethod
    def normalize_id(cls, value):
        return value.strip().upper() if isinstance(value, str) else value

    @field_validator("name", mode="before")
    @classmethod
    def strip_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class CreatedCrew(BaseModel):
    id: str
    name: str


# ---------- Helpers ------------------------------------------------------------


def require_token(credentials):
    if credentials is None:
        raise HTTPException(401, "Click Authorize in /docs and paste your access_token")
    return credentials.credentials


def get_user_id(token):
    try:
        return public_client().auth.get_user(token).user.id
    except Exception as error:
        raise HTTPException(401, f"Invalid or expired token: {error}") from error


def get_mission_types(token):
    try:
        rows = (
            user_client(token)
            .table("mission_types")
            .select("code, flight_days, post_flight_days")
            .execute()
            .data
        )
        return {
            r["code"]: (r["flight_days"], r["post_flight_days"]) for r in rows
        } or DEFAULT_MISSION_TYPES
    except Exception:
        return DEFAULT_MISSION_TYPES


def phase_and_adaptation(phase, mission_day, mission_type, mission_types):
    """pre_flight 0; flight min(days/75, 1); post_flight decays to 0 over recovery days."""
    flight_days, post_days = mission_types.get(mission_type, (None, None))
    if phase is None and mission_day is not None and flight_days:
        if mission_day < 0:
            phase = "pre_flight"
        elif mission_day < flight_days:
            phase = "flight"
        else:
            phase = "post_flight"
    if phase == "flight" and mission_day is not None:
        return phase, min(max(mission_day, 0) / ADAPTATION_DAYS, 1.0)
    if phase == "post_flight" and mission_day is not None and flight_days and post_days:
        at_landing = min(flight_days / ADAPTATION_DAYS, 1.0)
        return phase, at_landing * max(0.0, 1 - (mission_day - flight_days) / post_days)
    return phase, 0.0  # pre_flight or no mission: Earth baseline


def mission_context(vitals, day, rows):
    """Request values first, then the latest DB row that has a mission."""
    phase, mission_day, mission_type = (
        vitals.phase,
        vitals.mission_day,
        vitals.mission_type,
    )
    with_mission = [r for r in rows if r.get("mission_day") is not None]
    if with_mission:
        latest = max(with_mission, key=lambda r: r["day"])
        gap = (day - date.fromisoformat(latest["day"])).days
        if mission_day is None:
            mission_day = latest["mission_day"] + gap
        if mission_type is None:
            mission_type = latest.get("mission_type")
        if phase is None and gap == 0:
            phase = latest.get("phase")
    return phase, mission_day, mission_type


def history_frame(rows, astronaut_id, mission_types):
    """daily_readings rows -> DataFrame with the model's column names."""
    if not rows:
        return pd.DataFrame(columns=["astronaut", "day", "adaptation", *IND])
    df = pd.DataFrame(rows).rename(columns=DB_TO_ML)
    for c in IND:
        df[c] = pd.to_numeric(df.get(c), errors="coerce")
    df = df.dropna(subset=IND, how="all")
    df["adaptation"] = [
        phase_and_adaptation(
            r.get("phase"), r.get("mission_day"), r.get("mission_type"), mission_types
        )[1]
        for r in df.to_dict("records")
    ]
    df["astronaut"] = astronaut_id
    df["day"] = df["day"].map(lambda d: date.fromisoformat(d).toordinal())
    return df[["astronaut", "day", "adaptation", *IND]].reset_index(drop=True)


def impossible_values(vitals):
    """Values outside the ranges of the DB indicators table (sensor/entry errors)."""
    return out_of_range({c: getattr(vitals, c) for c in IND})


def run_analysis(token, vitals, astronaut_id, day, mission_types):
    """Reads the last 14 days from Supabase and runs the health engine."""
    try:
        rows = list_daily_readings(
            token,
            astronaut_id=astronaut_id,
            since=day - timedelta(days=WINDOW),
            until=day,
            limit=WINDOW + 1,
        )
    except Exception as error:
        raise HTTPException(
            502, f"Could not read history from Supabase: {error}"
        ) from error

    phase, mission_day, mission_type = mission_context(vitals, day, rows)
    phase, adaptation = phase_and_adaptation(
        phase, mission_day, mission_type, mission_types
    )

    past = [
        r for r in rows if r["day"] != day.isoformat()
    ]  # that day is the new reading
    history = history_frame(past, astronaut_id, mission_types)

    new = {c: getattr(vitals, c) for c in IND}
    new.update(
        astronaut=astronaut_id,
        day=day.toordinal(),
        adaptation=adaptation,
        exercising=vitals.exercising,
    )
    result = analyze(history, new, MODEL_PACKAGE)

    return AnalysisResult(
        **result,
        astronaut_id=astronaut_id,
        day=day,
        phase=phase,
        mission_day=mission_day,
        adaptation=round(adaptation, 3),
        history_days=len(history),
    )


def to_measurements(reading):
    """One offline reading -> 10 rows for the measurements table.
    Each row id is derived from the reading id (uuid5), so a resend gives the
    same ids and the database ignores it instead of duplicating it."""
    rows = []
    for c in IND:
        sensor, source = SENSOR_FOR[c]
        if reading.is_simulated:
            sensor, source = "orbit_health_simulator", "system"
        rows.append(
            {
                "id": str(uuid.uuid5(reading.id, c)),  # model name: keeps resends idempotent
                "indicator": c,  # indicator code in the DB
                "sensor_id": sensor,
                "value": getattr(reading, c),
                "status": "taken",
                "taken_at": reading.taken_at.isoformat(),
                "source": source,
                "is_simulated": reading.is_simulated,
                "exercising": reading.exercising,  # what the astronaut chose
            }
        )

    return rows


def save_analysis(token, reading, result):
    """Stores the traffic light in health_analyses (migration 010). Insert-only.

    Written with the service_role client (migration 013): users may not insert
    their own analyses, or they could forge the verdict. astronaut_id is set
    from result (the verified token owner), not from the client, and there is
    no auth.uid() for this client, so it must be passed explicitly.
    """
    row = {
        "id": str(reading.id),
        "astronaut_id": result.astronaut_id,
        "day": result.day.isoformat(),
        "traffic_light": result.traffic_light,
        "mode": "personal" if result.mode == "personal" else "startup",
        "clinical_reasons": result.clinical_reasons,
        "deviations": result.deviations,
        "connections": result.connections,
        "detected_by_ml": result.detected_by_ml,
        "model_version": MODEL_VERSION,
    }
    (
        service_client()
        .table("health_analyses")
        .upsert(row, on_conflict="id", ignore_duplicates=True, default_to_null=False)
        .execute()
    )


# ---------- Endpoints ------------------------------------------------------------


@app.get("/health")
def health():
    return {"status": "ok", "model_trained": MODEL_VERSION}


@app.post("/analysis", response_model=AnalysisResult)
def analysis(
    reading: Reading, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)
):
    """Preview: analyses one reading without saving anything."""
    token = require_token(credentials)
    problems = impossible_values(reading)
    if problems:  # e.g. 0 bpm: a sensor error, not a "low" value
        raise HTTPException(
            422,
            {
                "error": "measurement_error",
                "message": error_message(problems),
                "invalid_values": problems,
            },
        )
    astronaut_id = reading.astronaut_id or get_user_id(token)
    day = reading.day or datetime.now(timezone.utc).date()
    return run_analysis(token, reading, astronaut_id, day, get_mission_types(token))


@app.post("/sync", response_model=list[SyncItem])
def sync(
    readings: list[OfflineReading],
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    """Uploads the offline queue: for each reading (oldest first) saves its
    measurements, analyses it and saves the result. Safe to resend."""
    token = require_token(credentials)
    astronaut_id = get_user_id(
        token
    )  # always yourself: RLS only lets you save your own data
    mission_types = get_mission_types(token)

    results = []
    for reading in sorted(readings, key=lambda r: r.taken_at):
        problems = impossible_values(reading)
        if problems:  # the DB would reject it too; give a clear message instead
            results.append(SyncItem(id=reading.id, ok=False, error=error_message(problems)))
            continue
        try:
            inserted = save_measurements(token, to_measurements(reading))
            day = reading.taken_at.astimezone(timezone.utc).date()
            result = run_analysis(token, reading, astronaut_id, day, mission_types)
            save_analysis(token, reading, result)
            results.append(
                SyncItem(
                    id=reading.id,
                    ok=True,
                    new_measurements=len(inserted),
                    analysis=result,
                )
            )
        except Exception as error:  # one bad reading does not stop the rest
            detail = error.detail if isinstance(error, HTTPException) else str(error)
            results.append(SyncItem(id=reading.id, ok=False, error=detail))
    return results


# ---------- Admin: create accounts -----------------------------------------------

# The code decides the role (migration 012): ASP crew, LDR leader, ADM admin.
ROLE_PREFIX = {"crew": "ASP", "leader": "LDR", "admin": "ADM"}
# Technical login email: the DB trigger create_profile() reads the code from it
# (migrations 011 + 012) and the login page builds the same email (script_login.js).
LOGIN_EMAIL_DOMAIN = "crew.astra-health.test"
CREW_MAX_MEMBERS = 4  # migration 007


def require_admin(token, action="create accounts"):
    """403 unless the token belongs to an admin (profiles.role, same as is_admin() in RLS)."""
    user_id = get_user_id(token)
    rows = (
        user_client(token).table("profiles").select("role").eq("id", user_id).execute().data
    )
    if not rows or rows[0]["role"] != "admin":
        raise HTTPException(403, f"Only a ground admin can {action}")
    return user_id


def error_text(error):
    """Readable message from Supabase Auth / PostgREST errors."""
    return getattr(error, "message", None) or str(error)


@app.post("/admin/users", response_model=CreatedUser, status_code=201)
def create_account(
    new: NewUser, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)
):
    """Creates a Supabase Auth account + its profile. Admins only.

    The profile row is created by the create_profile() trigger from the technical
    email (code and role); this endpoint then sets the name and the crew.
    The database triggers enforce the same crew rules again (4 members, one leader).
    """
    token = require_token(credentials)
    require_admin(token)

    if not new.code.startswith(ROLE_PREFIX[new.role] + "-"):
        raise HTTPException(
            400, "The ID must match the role: crew -> ASP-0000, leader -> LDR-0000, admin -> ADM-0000"
        )
    if new.role == "admin" and new.crew_id:
        raise HTTPException(400, "Ground admins cannot belong to a crew")

    try:
        db = admin_client()
    except RuntimeError as error:
        raise HTTPException(503, "Server is missing SUPABASE_SECRET_KEY") from error

    if db.table("profiles").select("id").eq("astronaut_code", new.code).execute().data:
        raise HTTPException(409, f"{new.code} already exists")

    if new.crew_id:
        if not db.table("crews").select("id").eq("id", new.crew_id).execute().data:
            raise HTTPException(400, f"Crew {new.crew_id} does not exist")
        members = db.table("profiles").select("role").eq("crew_id", new.crew_id).execute().data
        has_leader = any(m["role"] == "leader" for m in members)
        if len(members) >= CREW_MAX_MEMBERS:
            raise HTTPException(409, f"Crew {new.crew_id} is full ({CREW_MAX_MEMBERS} members)")
        if new.role == "leader" and has_leader:
            raise HTTPException(409, f"Crew {new.crew_id} already has a leader")
        if new.role == "crew" and not has_leader:
            raise HTTPException(409, f"Crew {new.crew_id} has no leader yet: create its LDR first")

    # 1) Auth account (the trigger creates the profile with code + role)
    try:
        created = db.auth.admin.create_user(
            {
                "email": f"{new.code.lower()}@{LOGIN_EMAIL_DOMAIN}",
                "password": new.password,
                "email_confirm": True,
                "user_metadata": {"name": new.name},
                "app_metadata": {"role": new.role},  # ADM accounts require role = admin
            }
        )
    except Exception as error:
        text = error_text(error)
        status = 409 if "already" in text.lower() else 400
        raise HTTPException(status, f"Could not create the account: {text}") from error

    user_id = created.user.id

    # 2) Name + crew on the profile; undo the account if anything fails
    try:
        changes = {"name": new.name}
        if new.crew_id:
            changes["crew_id"] = new.crew_id
        db.table("profiles").update(changes).eq("id", user_id).execute()
        profile = (
            db.table("profiles")
            .select("id, name, astronaut_code, role, crew_id")
            .eq("id", user_id)
            .single()
            .execute()
            .data
        )
        if profile["astronaut_code"] != new.code or profile["role"] != new.role:
            raise RuntimeError("the profile did not get the expected code and role")
    except Exception as error:
        try:
            db.auth.admin.delete_user(user_id)
        except Exception:
            pass  # reported below; the admin can retry with the same code once removed
        raise HTTPException(400, f"Could not save the profile: {error_text(error)}") from error

    return CreatedUser(**profile)


@app.post("/admin/crews", response_model=CreatedCrew, status_code=201)
def create_crew_endpoint(
    new: NewCrew, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)
):
    """Creates a crew. Admins only.

    Uses the admin's own token (no secret key): the RLS policy "crews: admin
    creates" (migration 005) checks the role again in the database. The new
    crew starts empty; its LDR must be added before any ASP (migration 012).
    """
    token = require_token(credentials)
    require_admin(token, "create crews")
    try:
        row = create_crew(token, new.id, new.name)
    except Exception as error:
        text = error_text(error)
        code = str(getattr(error, "code", "") or "")
        if code == "23505" or "duplicate" in text.lower():
            raise HTTPException(409, f"Crew {new.id} already exists") from error
        if code == "42501" or "row-level security" in text.lower():
            raise HTTPException(403, "Only a ground admin can create crews") from error
        raise HTTPException(400, f"Could not create the crew: {text}") from error
    return CreatedCrew(id=row["id"], name=row["name"])


class BodyAnalysis(BaseModel):
    """GET /body/{system}: what frontend/script_BodyAi.js shows (same field names)."""

    updatedAgo: str = ""  # e.g. "2 min ago"
    summary: str  # "AI analysis" box
    status: Literal["stable", "watch", "attention"]
    metric: dict = {}  # {label, value, unit, trend, points}; empty = no sensor
    explanation: str = ""
    recommendations: list[str] = []
    source: str  # ai / cache / demo / template / measurement_error / no_sensor / no_data


def latest_analysis(token, astronaut_id):
    """Newest traffic light saved by /sync (health_analyses, readable by its owner)."""
    rows = (
        user_client(token)
        .table("health_analyses")
        .select(
            "day, traffic_light, mode, clinical_reasons, deviations, connections,"
            " detected_by_ml, analyzed_at"
        )
        .eq("astronaut_id", astronaut_id)
        .order("day", desc=True)
        .order("analyzed_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    return rows[0] if rows else None


@app.get("/body/{system}", response_model=BodyAnalysis)
def body(
    system: str, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)
):
    """Body AI screen: the AI explains the latest analysis for one body system.
    Uses what /sync already saved; one Claude call per request (~$0.0002)."""
    token = require_token(credentials)
    if system not in SYSTEMS:
        raise HTTPException(404, f"Unknown system. Options: {', '.join(SYSTEMS)}")
    info = SYSTEMS[system]
    if not info["indicators"]:
        return BodyAnalysis(
            summary=f"No sensor measures the {info['name'].lower()} yet.",
            status="stable",
            explanation="This system has no readings in Astra Health, so there is nothing to analyse.",
            source="no_sensor",
        )

    astronaut_id = get_user_id(token)
    try:
        analysis = latest_analysis(token, astronaut_id)
        rows = list_daily_readings(token, astronaut_id=astronaut_id, limit=WINDOW + 1)
    except Exception as error:
        raise HTTPException(502, f"Could not read Supabase: {error}") from error
    if analysis is None or not rows:
        return BodyAnalysis(
            summary="No readings yet. Complete a check-in to see your analysis.",
            status="stable",
            source="no_data",
        )

    rows = [{DB_TO_ML.get(k, k): v for k, v in r.items()} for r in rows]
    row = next((r for r in rows if r["day"] == analysis["day"]), rows[0])
    verdict = {
        k: analysis[k]
        for k in ("traffic_light", "mode", "clinical_reasons", "deviations",
                  "connections", "detected_by_ml")
    }
    status = system_status(system, verdict)
    values = {c: row[c] for c in IND if row.get(c) is not None}
    if out_of_range(values):  # impossible value anywhere: never hide it
        ai_verdict, ai_values = verdict, values
    else:
        ai_verdict, ai_values = focused(system, verdict, values)
    context = {
        "exercising": bool(row.get("exercising")),
        "values": ai_values,
        "focus": {**focus(system), "status": status},
    }
    text = explain(ai_verdict, context)
    if text["source"] == "measurement_error":
        status = "attention"
    return BodyAnalysis(
        updatedAgo=updated_ago(analysis.get("analyzed_at")),
        summary=text["summary"],
        status=status,
        metric=system_metric(system, rows),
        explanation=text["detail"],
        recommendations=text["recommendations"],
        source=text["source"],
    )
