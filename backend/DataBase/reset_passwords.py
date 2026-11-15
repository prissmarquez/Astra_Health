"""Sets a new password for the 9 demo accounts (same password for all).

The password is typed twice in the terminal (never stored or shown).
Needs the SECRET key, read from backend/DataBase/.env or asked if missing:
    cd backend/DataBase
    .venv\\Scripts\\python reset_passwords.py
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

CODES = ["ADM-0001", "LDR-1001", "ASP-1001", "ASP-1002", "ASP-1003",
         "LDR-2001", "ASP-2001", "ASP-2002", "ASP-2003"]

password = getpass("New password for the demo accounts (min 8 characters, not shown): ")
if len(password) < 8:
    raise SystemExit("The password needs at least 8 characters.")
if getpass("Type it again: ") != password:
    raise SystemExit("The passwords do not match. Nothing was changed.")

for code in CODES:
    rows = admin.table("profiles").select("id").eq("astronaut_code", code).execute().data
    if not rows:
        print(code, "not found")
        continue
    admin.auth.admin.update_user_by_id(rows[0]["id"], {"password": password})
    print(code, "password updated")
