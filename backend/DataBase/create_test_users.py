"""Creates the demo accounts with Gael's codes (migrations 011 + 012) and crew ASTRA-A.

Crew ASTRA-A (max 4): LDR-1001 (leader) + ASP-1001 + ASP-1002 + ASP-1003.
Ground: ADM-0001 (admin, never in a crew).

Needs the SECRET key (an ADM account needs app_metadata.role = admin, which onlys
the secret key can set). Type it in the terminal only, never in a file or git:
    cd backend/DataBase
    export SUPABASE_SECRET_KEY="sb_secret_..."
    python3 create_test_users.py
"""

import os
from getpass import getpass

from dotenv import load_dotenv
from supabase import create_client

load_dotenv()  # reads SUPABASE_URL from backend/DataBase/.env
admin = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])

DOMAIN = "crew.astra-health.test"  # technical email domain from migration 011
CREW = "ASTRA-A"

# (code, name). The leader goes first: an empty crew accepts no ASP until its LDR joins.
ACCOUNTS = [
    ("LDR-1001", "Leader 1001"),
    ("ASP-1001", "Astronaut 1001"),
    ("ASP-1002", "Astronaut 1002"),
    ("ASP-1003", "Astronaut 1003"),
    ("ADM-0001", "Ground Admin"),
]

password = getpass("Password for all demo accounts: ")


def user_id(code):
    rows = admin.table("profiles").select("id").eq("astronaut_code", code).execute().data
    return rows[0]["id"] if rows else None


# 1) Accounts (the profile and its role are created by the database from the code)
for code, name in ACCOUNTS:
    if user_id(code):
        print(code, "already exists")
        continue
    admin.auth.admin.create_user({
        "email": f"{code.lower()}@{DOMAIN}",
        "password": password,
        "email_confirm": True,
        "user_metadata": {"name": name},
        "app_metadata": {"role": "admin"} if code.startswith("ADM") else {},
    })
    print(code, "created")

# 2) Crew
admin.table("crews").upsert({"id": CREW, "name": "Astra Crew A"}).execute()

# 3) Members, leader first (the crew rejects ASP until its LDR has joined)
for code in ["LDR-1001", "ASP-1001", "ASP-1002", "ASP-1003"]:
    uid = user_id(code)
    admin.table("profiles").update({"crew_id": CREW}).eq("id", uid).execute()

# 4) Check
for p in admin.table("profiles").select("astronaut_code, name, role, crew_id").order("role").execute().data:
    print(p)
