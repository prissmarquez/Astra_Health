"""Comprueba la conexión y la seguridad con un usuario de prueba real.

Uso (desde backend/DataBase, con el .env lleno):
    python prueba_conexion.py

Deja UNA medición simulada (origen 'simulador', es_simulado = true) porque
las mediciones no se pueden borrar desde la app: eso es parte de la prueba.
"""

import os
from datetime import datetime, timezone

from conexion import cliente_de_usuario, cliente_publico
from mediciones import consultar_mediciones, guardar_medicion, nueva_medicion


def paso(texto: str) -> None:
    print(f"\n▶ {texto}")


paso("1. Sin sesión no se ve nada (RLS)")
try:
    anonimo = cliente_publico().table("indicadores").select("codigo").execute().data
    print("   OK" if anonimo == [] else f"   ⚠ Se ven datos sin sesión: {anonimo}")
except Exception as error:  # lo esperado: "permission denied"
    print("   OK, bloqueado:", type(error).__name__)

paso("2. Iniciar sesión con el usuario de prueba")
sesion = cliente_publico().auth.sign_in_with_password({
    "email": os.environ["PRUEBA_CORREO"],
    "password": os.environ["PRUEBA_CONTRASENA"],
})
token = sesion.session.access_token
print("   OK, usuario", sesion.user.id)

paso("3. Leer catálogos")
cliente = cliente_de_usuario(token)
indicadores = cliente.table("indicadores").select("codigo, unidad").execute().data
print(f"   {len(indicadores)} indicadores:", ", ".join(i["codigo"] for i in indicadores))

paso("4. Guardar una medición simulada")
medicion = nueva_medicion("frecuencia_cardiaca", "simulador_orbit_health", 72,
                          datetime.now(timezone.utc), origen="simulador",
                          es_simulado=True, contexto="prueba_conexion")
print("   insertada:", guardar_medicion(token, medicion) is not None)

paso("5. Reenviar la MISMA medición (simula sincronización offline)")
print("   ignorada sin duplicar:", guardar_medicion(token, medicion) is None)

paso("6. Intentar editarla (debe quedar sin cambios)")
try:
    editadas = cliente.table("mediciones").update({"valor": 999}).eq("id", medicion["id"]).execute().data
    print("   OK, bloqueado" if not editadas else f"   ⚠ Se pudo editar: {editadas}")
except Exception as error:  # Postgres responde "permission denied"
    print("   OK, bloqueado:", type(error).__name__)

paso("7. Valor fuera de rango (debe rechazarse)")
try:
    guardar_medicion(token, nueva_medicion("spo2", "simulador_orbit_health", 150,
                                           datetime.now(timezone.utc), es_simulado=True,
                                           origen="simulador"))
    print("   ⚠ Se aceptó un SpO2 de 150 %")
except Exception as error:
    print("   OK, rechazado:", type(error).__name__)

paso("8. Consultar mis mediciones")
for fila in consultar_mediciones(token, indicador="frecuencia_cardiaca", limite=3):
    print("  ", fila["tomada_en"], fila["valor"], fila["indicadores"]["unidad"],
          "·", fila["sensor_indicadores"]["sensores"]["nombre"])

print("\n✔ Prueba terminada")
