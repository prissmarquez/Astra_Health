"""Funciones para que Backend 2 guarde y consulte mediciones.

Todas reciben el access_token del usuario: RLS decide qué puede ver y escribir.
Las mediciones no se editan ni se borran; para corregir se usa repetir_medicion.
"""

import uuid
from datetime import datetime
from typing import Any

from conexion import cliente_de_usuario

CAMPOS_PERMITIDOS = {
    "id", "indicador", "sensor_id", "estado", "valor", "tomada_en",
    "mision_id", "etapa", "contexto", "origen", "es_simulado", "repite_a",
}
OBLIGATORIOS = {"id", "indicador", "sensor_id", "tomada_en"}


def nueva_medicion(indicador: str, sensor_id: str, valor: float | None,
                   tomada_en: datetime, **extra: Any) -> dict:
    """Arma una medición con UUID nuevo (en la app esto se hace en el dispositivo)."""
    return {
        "id": str(uuid.uuid4()),
        "indicador": indicador,
        "sensor_id": sensor_id,
        "valor": valor,
        "estado": "tomada" if valor is not None else extra.pop("estado", "fallida"),
        "tomada_en": tomada_en.isoformat(),
        **extra,
    }


def _limpiar(medicion: dict) -> dict:
    sobrantes = set(medicion) - CAMPOS_PERMITIDOS
    if sobrantes:
        # usuario_id y recibida_en los pone la base; nunca el cliente.
        raise ValueError(f"Campos no permitidos: {sorted(sobrantes)}")
    faltantes = OBLIGATORIOS - set(medicion)
    if faltantes:
        raise ValueError(f"Faltan campos: {sorted(faltantes)}")
    uuid.UUID(str(medicion["id"]))  # valida el formato
    return medicion


def guardar_mediciones(access_token: str, mediciones: list[dict]) -> list[dict]:
    """Guarda un lote (p. ej. la cola offline). Es idempotente:
    si un id ya existía, se ignora en silencio y no se duplica.
    Devuelve solo las filas que se insertaron en esta llamada.
    """
    if not mediciones:
        return []
    filas = [_limpiar(dict(m)) for m in mediciones]
    respuesta = (
        cliente_de_usuario(access_token)
        .table("mediciones")
        .upsert(filas, on_conflict="id", ignore_duplicates=True, default_to_null=False)
        .execute()
    )
    return respuesta.data


def guardar_medicion(access_token: str, medicion: dict) -> dict | None:
    """Guarda una sola medición. None si ya existía (reenvío)."""
    insertadas = guardar_mediciones(access_token, [medicion])
    return insertadas[0] if insertadas else None


def repetir_medicion(access_token: str, original_id: str, sensor_id: str,
                     valor: float | None, tomada_en: datetime, **extra: Any) -> dict | None:
    """Registra una nueva toma del mismo indicador que apunta a la original.
    La original queda intacta (historial completo)."""
    original = (
        cliente_de_usuario(access_token)
        .table("mediciones")
        .select("indicador, mision_id, etapa")
        .eq("id", original_id)
        .maybe_single()
        .execute()
    )
    if original is None or not original.data:
        raise LookupError("No existe esa medición o no es tuya.")
    base = {k: v for k, v in original.data.items() if v is not None and k != "indicador"}
    nueva = nueva_medicion(original.data["indicador"], sensor_id, valor, tomada_en,
                           repite_a=original_id, **{**base, **extra})
    return guardar_medicion(access_token, nueva)


def consultar_mediciones(access_token: str, indicador: str | None = None,
                         desde: datetime | None = None, hasta: datetime | None = None,
                         mision_id: str | None = None, etapa: str | None = None,
                         limite: int = 500) -> list[dict]:
    """Mediciones del usuario, de la más reciente a la más antigua."""
    consulta = (
        cliente_de_usuario(access_token)
        .table("mediciones")
        .select("*, indicadores(nombre, unidad), sensor_indicadores(metodo, sensores(nombre))")
        .order("tomada_en", desc=True)
        .limit(min(max(limite, 1), 1000))
    )
    if indicador:
        consulta = consulta.eq("indicador", indicador)
    if desde:
        consulta = consulta.gte("tomada_en", desde.isoformat())
    if hasta:
        consulta = consulta.lte("tomada_en", hasta.isoformat())
    if mision_id:
        consulta = consulta.eq("mision_id", mision_id)
    if etapa:
        consulta = consulta.eq("etapa", etapa)
    return consulta.execute().data
