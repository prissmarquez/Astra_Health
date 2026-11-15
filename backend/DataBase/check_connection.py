"""Checks the connection and the security rules with a real test user.

Usage (from backend/DataBase, with backend/.env filled in):
    python check_connection.py

It leaves ONE simulated measurement behind (is_simulated = true) because
measurements cannot be deleted from the app: that is part of what this
script checks.
"""

import os
from datetime import datetime, timezone

from connection import public_client, user_client
from measurements import (list_daily_readings, list_measurements, new_measurement,
                          save_measurement)


def step(text: str) -> None:
    print(f"\n> {text}")


step("1. Without a session nothing is visible (RLS)")
try:
    anonymous = public_client().table("indicators").select("code").execute().data
    print("   OK" if anonymous == [] else f"   WARNING: data visible without a session: {anonymous}")
except Exception as error:  # expected: "permission denied"
    print("   OK, blocked:", type(error).__name__)

step("2. Sign in with the test user")
session = public_client().auth.sign_in_with_password({
    "email": os.environ["TEST_EMAIL"],
    "password": os.environ["TEST_PASSWORD"],
})
token = session.session.access_token
client = user_client(token)
me = client.table("profiles").select("role").eq("id", session.user.id).single().execute().data
print("   OK, user", session.user.id, "- role:", me["role"])

step("3. Read catalogs")
indicators = client.table("indicators").select("code").execute().data
types = client.table("mission_types").select("code").execute().data
print(f"   {len(indicators)} indicators:", ", ".join(i["code"] for i in indicators))
print(f"   {len(types)} mission types:", ", ".join(t["code"] for t in types))

step("4. Save a simulated measurement")
measurement = new_measurement("heart_rate", "orbit_health_simulator", 72,
                              datetime.now(timezone.utc), source="system",
                              is_simulated=True, context="check_connection")
print("   inserted:", save_measurement(token, measurement) is not None)

step("5. Resend the SAME measurement (simulates offline sync)")
print("   ignored, not duplicated:", save_measurement(token, measurement) is None)

step("6. Try to edit it (must stay unchanged)")
try:
    edited = client.table("measurements").update({"value": 999}).eq("id", measurement["id"]).execute().data
    print("   OK, blocked" if not edited else f"   WARNING: it could be edited: {edited}")
except Exception as error:  # Postgres answers "permission denied"
    print("   OK, blocked:", type(error).__name__)

step("7. Out-of-range value (must be rejected)")
try:
    save_measurement(token, new_measurement("spo2", "orbit_health_simulator", 150,
                                            datetime.now(timezone.utc), source="system",
                                            is_simulated=True))
    print("   WARNING: an SpO2 of 150 % was accepted")
except Exception as error:
    print("   OK, rejected:", type(error).__name__)

step("8. History (readings_detailed)")
for row in list_measurements(token, indicator="heart_rate", limit=3):
    print("  ", row["taken_date"], row["taken_time"], row["astronaut"] or "(no name)",
          row["value"], row["unit"], "-", row["sensor_name"],
          "- phase:", row["phase"], "- adaptation:", row["adaptation"])

step("9. One row per day (daily_readings)")
for row in list_daily_readings(token, limit=3):
    print("  ", row["day"], "heart_rate:", row["heart_rate"], "- phase:", row["phase"])

print("\nDone: check finished")
