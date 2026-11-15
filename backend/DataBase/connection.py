"""Supabase connection for the Astra Health backend.

We always use the PUBLISHABLE key + the token (JWT) of the user making the
request. That way Postgres enforces RLS: each user only sees and records their
own data, even if there is a bug in the backend code.
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

# Reads backend/DataBase/.env (never committed to git).
load_dotenv(Path(__file__).with_name(".env"))


def _env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(
            f"Missing {name}. Copy .env.example to .env in backend/DataBase and fill it in."
        )
    return value


def public_client() -> Client:
    """Client without a user. Used to sign in; it cannot read any table (RLS)."""
    return create_client(_env("SUPABASE_URL"), _env("SUPABASE_PUBLISHABLE_KEY"))


def user_client(access_token: str) -> Client:
    """Client that acts as the user who owns the token.

    access_token: the JWT the front-end gets from Supabase Auth and sends to
    the backend in the "Authorization: Bearer <token>" header.
    """
    if not access_token:
        raise ValueError("The user's access_token is required.")
    client = public_client()
    client.postgrest.auth(access_token)
    return client
