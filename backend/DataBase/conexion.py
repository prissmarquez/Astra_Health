"""Conexión a Supabase para el backend de Astra Health.

Siempre usamos la llave PUBLICABLE + el token (JWT) del usuario que hace la
petición. Así Postgres aplica RLS: cada quien solo ve y registra lo suyo,
aunque haya un error en el código del backend.
"""

import os
from pathlib import Path

from dotenv import load_dotenv
from supabase import Client, create_client

# Lee backend/DataBase/.env (no se sube a git).
load_dotenv(Path(__file__).with_name(".env"))


def _variable(nombre: str) -> str:
    valor = os.environ.get(nombre, "").strip()
    if not valor:
        raise RuntimeError(
            f"Falta {nombre}. Copia .env.example como .env en backend/DataBase y llénalo."
        )
    return valor


def cliente_publico() -> Client:
    """Cliente sin usuario. Sirve para iniciar sesión; no lee ninguna tabla (RLS)."""
    return create_client(_variable("SUPABASE_URL"), _variable("SUPABASE_PUBLISHABLE_KEY"))


def cliente_de_usuario(access_token: str) -> Client:
    """Cliente que actúa como el usuario dueño del token.

    access_token: el JWT que el front-end obtiene de Supabase Auth y envía a
    FastAPI en el encabezado "Authorization: Bearer <token>".
    """
    if not access_token:
        raise ValueError("Se necesita el access_token del usuario.")
    cliente = cliente_publico()
    cliente.postgrest.auth(access_token)
    return cliente
