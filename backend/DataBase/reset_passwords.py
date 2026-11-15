import os
from pathlib import Path
from getpass import getpass

from dotenv import load_dotenv
from supabase import create_client

load_dotenv(Path(__file__).resolve().parent.parent / ".env")  # backend/.env
admin = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SECRET_KEY"])

password = getpass("New password for the demo accounts (min 6 characters): ")

for code in ["LDR-1001", "ASP-1001", "ASP-1002", "ASP-1003"]:
    rows = admin.table("profiles").select("id").eq("astronaut_code", code).execute().data
    if not rows:
        print(code, "not found")
        continue
    admin.auth.admin.update_user_by_id(rows[0]["id"], {"password": password})
    print(code, "password updated")
