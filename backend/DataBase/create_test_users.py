"""Creates the demo ACCOUNTS only (Supabase Auth). Crews, missions and the
simulated history are loaded afterwards with SQL (see README, "Demo data").

Ground:   ADM-0001 (the only admin; never in a crew)
ASTRA-01: LDR-1001 + ASP-1001, ASP-1002, ASP-1003   (mission MSN-01, 5 days of data)
ASTRA-02: LDR-2001 + ASP-2001, ASP-2002, ASP-2003   (mission MSN-02, 3 days of data)

Every account gets the same password, typed in the terminal (never stored).
Needs the SECRET key (the ADM account needs app_metadata.role = admin, which only
the secret key can set). Keep it in backend/.env or type it in the terminal:
    cd backend/DataBase
    python create_test_users.py
"""

import os
from getpass import getpass
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")         # backend/DataBase/.env
load_dotenv(HERE.parent / ".env")  # backend/.env (if it exists)
if not os.environ.get("SUPABASE_SECRET_KEY"):
    os.environ["SUPABASE_SECRET_KEY"] = getpass("Secret key (sb_secret_..., not shown): ")
admin = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])

DOMAIN = "crew.astra-health.test"  # technical email domain (migration 011)

# (code, name). The database sets the role from the code (migration 012).
ACCOUNTS = [
    ("ADM-0001", "Ground Control"),
    ("LDR-1001", "Elena Torres"),
    ("ASP-1001", "Marco Silva"),
    ("ASP-1002", "Mei Chen"),
    ("ASP-1003", "Daniel Kim"),
    ("LDR-2001", "Sofia Ramirez"),
    ("ASP-2001", "Lucas Martin"),
    ("ASP-2002", "Aisha Okafor"),
    ("ASP-2003", "Noah Fischer"),
]

password = getpass("Password for all demo accounts (min 8 characters): ")
if len(password) < 8:
    raise SystemExit("The password needs at least 8 characters.")


def user_id(code):
    rows = admin.table("profiles").select("id").eq("astronaut_code", code).execute().data
    return rows[0]["id"] if rows else None


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

for p in admin.table("profiles").select("astronaut_code, name, role").order("astronaut_code").execute().data:
    print(p)
