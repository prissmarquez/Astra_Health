"""Functions for Backend 2 to save and query measurements (and assign crews).

Every function takes the user's access_token: RLS decides what they can see
and write (crew: only their own data; admin: everyone's). Measurements are
never edited or deleted; use repeat_measurement to take a new reading instead.
"""

import uuid
from datetime import date, datetime
from typing import Any

from connection import user_client

ALLOWED_FIELDS = {
    "id", "indicator", "sensor_id", "status", "value", "taken_at", "source",
    "mission_id", "context", "is_simulated", "repeats_id",
}
REQUIRED_FIELDS = {"id", "indicator", "sensor_id", "taken_at", "source"}
SOURCES = {"bluetooth", "system", "calculated", "questionnaire", "manual"}


def new_measurement(indicator: str, sensor_id: str, value: float | None,
                    taken_at: datetime, source: str, **extra: Any) -> dict:
    """Builds a measurement with a new UUID (in the app this happens on the device).

    source: how the value got in - bluetooth, system, calculated, questionnaire or manual.
    The mission, phase and mission day are filled in by the database.
    """
    if source not in SOURCES:
        raise ValueError(f"source must be one of {sorted(SOURCES)}")
    return {
        "id": str(uuid.uuid4()),
        "indicator": indicator,
        "sensor_id": sensor_id,
        "value": value,
        "status": "taken" if value is not None else extra.pop("status", "failed"),
        "taken_at": taken_at.isoformat(),
        "source": source,
        **extra,
    }


def _clean(measurement: dict) -> dict:
    extra = set(measurement) - ALLOWED_FIELDS
    if extra:
        # user_id and received_at are set by the database, never by the client.
        raise ValueError(f"Fields not allowed: {sorted(extra)}")
    missing = REQUIRED_FIELDS - set(measurement)
    if missing:
        raise ValueError(f"Missing fields: {sorted(missing)}")
    uuid.UUID(str(measurement["id"]))  # validates the format
    return measurement


def save_measurements(access_token: str, measurements: list[dict]) -> list[dict]:
    """Saves a batch (e.g. the offline queue). Idempotent:
    if an id already exists it is silently ignored, never duplicated.
    Returns only the rows inserted by this call.
    """
    if not measurements:
        return []
    rows = [_clean(dict(m)) for m in measurements]
    response = (
        user_client(access_token)
        .table("measurements")
        .upsert(rows, on_conflict="id", ignore_duplicates=True, default_to_null=False)
        .execute()
    )
    return response.data


def save_measurement(access_token: str, measurement: dict) -> dict | None:
    """Saves a single measurement. None if it already existed (resend)."""
    inserted = save_measurements(access_token, [measurement])
    return inserted[0] if inserted else None


def repeat_measurement(access_token: str, original_id: str, sensor_id: str,
                       value: float | None, taken_at: datetime, source: str,
                       **extra: Any) -> dict | None:
    """Records a new reading of the same indicator that points to the original.
    The original stays untouched (full history)."""
    original = (
        user_client(access_token)
        .table("measurements")
        .select("indicator")
        .eq("id", original_id)
        .maybe_single()
        .execute()
    )
    if original is None or not original.data:
        raise LookupError("That measurement does not exist or is not yours.")
    repeat = new_measurement(original.data["indicator"], sensor_id, value, taken_at,
                             source, repeats_id=original_id, **extra)
    return save_measurement(access_token, repeat)


def list_measurements(access_token: str, indicator: str | None = None,
                      mission_type: str | None = None, phase: str | None = None,
                      astronaut_id: str | None = None, crew_id: str | None = None,
                      since: datetime | None = None, until: datetime | None = None,
                      limit: int = 500) -> list[dict]:
    """Full history (one row per measurement), newest first, from readings_detailed.

    Each row has: astronaut, indicator, sensor, value, mission_type, phase,
    taken_date, taken_time, mission_day, adaptation and crew_id (the crew
    the astronaut had when the measurement was taken).
    astronaut_id and crew_id only make a difference for the admin
    (crew members only see themselves).
    """
    query = (
        user_client(access_token)
        .table("readings_detailed")
        .select("*")
        .order("taken_at", desc=True)
        .limit(min(max(limit, 1), 1000))
    )
    if indicator:
        query = query.eq("indicator", indicator)
    if mission_type:
        query = query.eq("mission_type", mission_type)
    if phase:
        query = query.eq("phase", phase)
    if astronaut_id:
        query = query.eq("astronaut_id", astronaut_id)
    if crew_id:
        query = query.eq("crew_id", crew_id)
    if since:
        query = query.gte("taken_at", since.isoformat())
    if until:
        query = query.lte("taken_at", until.isoformat())
    return query.execute().data


def list_daily_readings(access_token: str, astronaut_id: str | None = None,
                        crew_id: str | None = None,
                        mission_type: str | None = None, phase: str | None = None,
                        since: date | None = None, until: date | None = None,
                        limit: int = 500) -> list[dict]:
    """One row per astronaut per day with the LATEST value of each indicator
    (heart_rate, hrv, spo2, ...), newest day first, from daily_readings."""
    query = (
        user_client(access_token)
        .table("daily_readings")
        .select("*")
        .order("day", desc=True)
        .limit(min(max(limit, 1), 1000))
    )
    if astronaut_id:
        query = query.eq("astronaut_id", astronaut_id)
    if crew_id:
        query = query.eq("crew_id", crew_id)
    if mission_type:
        query = query.eq("mission_type", mission_type)
    if phase:
        query = query.eq("phase", phase)
    if since:
        query = query.gte("day", since.isoformat())
    if until:
        query = query.lte("day", until.isoformat())
    return query.execute().data


def set_user_crew(access_token: str, user_id: str, crew_id: str | None) -> None:
    """Admin only: moves an astronaut to a crew (or removes them with None).
    The database rejects the call if the token does not belong to an admin.
    The astronaut is added automatically to that crew's unfinished missions;
    their past measurements keep the crew they had at the time."""
    user_client(access_token).rpc(
        "set_user_crew", {"target_user": user_id, "target_crew": crew_id}
    ).execute()


def set_crew_leader(access_token: str, user_id: str) -> None:
    """Admin only: makes user_id the leader of their crew.
    The previous leader goes back to 'crew'. Every crew with members
    always has exactly one leader."""
    user_client(access_token).rpc("set_crew_leader", {"target_user": user_id}).execute()


def crew_latest(access_token: str, indicator: str | None = None) -> list[dict]:
    """For each crewmate of the signed-in user: the LATEST value of the
    selected indicator (or of every indicator if None), taken while in this
    crew, plus their latest adaptation score. Any crew member can call it.

    The leader (and the admin) can also read the crew's full history with
    list_measurements / list_daily_readings."""
    params = {"p_indicator": indicator} if indicator else {}
    return user_client(access_token).rpc("crew_latest", params).execute().data
