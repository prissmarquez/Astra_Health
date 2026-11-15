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
from pydantic import AwareDatetime, BaseModel, Field

# ml/ and DataBase/ are plain script folders, so we add them to the import path
BACKEND = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND / "ml"))
sys.path.insert(0, str(BACKEND / "DataBase"))

from connection import public_client, service_client, user_client  # noqa: E402
from health_engine import IND, WINDOW, analyze  # noqa: E402
from measurements import list_daily_readings, save_measurements  # noqa: E402

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
    allow_methods=["GET", "POST", "OPTIONS"],
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
