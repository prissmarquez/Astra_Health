import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import joblib
import pandas as pd
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ml/ and DataBase/ are plain script folders, so we add them to the import path
BACKEND = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND / "ml"))
sys.path.insert(0, str(BACKEND / "DataBase"))

from connection import public_client, user_client  # noqa: E402
from health_engine import IND, WINDOW, analyze  # noqa: E402
from measurements import list_daily_readings  # noqa: E402

# DB column names -> names the model was trained with (only the ones that differ)
DB_TO_ML = {
    "systolic_bp": "systolic_pressure",
    "diastolic_bp": "diastolic_pressure",
    "mood_positive": "positive_mood",
    "mood_negative": "negative_mood",
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

MODEL_PACKAGE = joblib.load(BACKEND / "ml" / "isolation_forest_model.pkl")


class Reading(BaseModel):
    heart_rate: float = Field(..., examples=[68])
    hrv: float = Field(..., examples=[55])
    sleep_min: float = Field(..., examples=[400])
    positive_mood: float = Field(..., examples=[32])
    negative_mood: float = Field(..., examples=[14])
    glucose: float = Field(..., examples=[78])
    systolic_pressure: float = Field(..., examples=[115])
    diastolic_pressure: float = Field(..., examples=[75])
    temperature: float = Field(..., examples=[37.0])
    spo2: float = Field(..., examples=[98])
    exercising: bool = False
    day: date | None = None  # empty = today (UTC)
    astronaut_id: str | None = None  # empty = the token's owner
    # Optional overrides for testing when there is no mission in the DB
    phase: Literal["pre_flight", "flight", "post_flight"] | None = None
    mission_day: int | None = None  # 0 = launch day, negative = pre-flight
    mission_type: Literal["short", "standard", "long"] | None = None


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


def get_token(authorization):
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            401, "Send the header  Authorization: Bearer <access_token>"
        )
    return authorization.split(" ", 1)[1].strip()


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


def mission_context(reading, day, rows):
    """Request values first, then the latest DB row that has a mission."""
    phase, mission_day, mission_type = (
        reading.phase,
        reading.mission_day,
        reading.mission_type,
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


@app.get("/health")
def health():
    return {"status": "ok", "model_trained": MODEL_PACKAGE.get("trained")}


@app.post("/analysis", response_model=AnalysisResult)
def analysis(reading: Reading, authorization: str | None = Header(None)):
    token = get_token(authorization)
    astronaut_id = reading.astronaut_id or get_user_id(token)
    day = reading.day or datetime.now(timezone.utc).date()

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

    mission_types = get_mission_types(token)
    phase, mission_day, mission_type = mission_context(reading, day, rows)
    phase, adaptation = phase_and_adaptation(
        phase, mission_day, mission_type, mission_types
    )

    past = [r for r in rows if r["day"] != day.isoformat()]  # today is the new reading
    history = history_frame(past, astronaut_id, mission_types)

    new = {c: getattr(reading, c) for c in IND}
    new.update(
        astronaut=astronaut_id,
        day=day.toordinal(),
        adaptation=adaptation,
        exercising=reading.exercising,
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
