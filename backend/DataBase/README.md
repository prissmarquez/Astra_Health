# Base de datos · Astra Health (Supabase)

Responsable: Back-end 1. Todo el equipo usa **un solo proyecto de Supabase**.

```
backend/DataBase/
├── migrations/
│   ├── 001_esquema_inicial.sql   tablas, tipos y validaciones
│   ├── 002_seguridad_rls.sql     permisos (RLS)
│   └── 003_catalogos.sql         indicadores, sensores y qué mide cada uno
├── conexion.py                   cliente de Supabase (llave publicable + token)
├── mediciones.py                 funciones para Backend 2
├── prueba_conexion.py            prueba de conexión y seguridad
├── requirements.txt
├── .env.example                  nombres de variables, SIN valores
└── .gitignore                    impide subir .env y .venv
```

## Modelo de datos

| Tabla | Qué guarda |
|---|---|
| `auth.users` | Usuarios y contraseñas. La gestiona Supabase Auth; no la tocamos. |
| `perfiles` | Uno por usuario (se crea solo al registrarse). Nombre. |
| `misiones` | Nombre, lanzamiento, regreso planeado/real. **La duración en días se calcula sola.** |
| `participantes_mision` | Qué usuarios están en cada misión. |
| `indicadores` | Lista fija con unidad única y rango de captura. |
| `sensores` | Sensores reales usados en vuelo, con fabricante, agencia, misión y fuente. |
| `sensor_indicadores` | Qué indicador mide cada sensor y con qué método. |
| `mediciones` | Una fila por indicador: **sensor**, **valor**, **estado** (si se tomó), fecha, misión, **etapa**, origen. |

**Indicadores:** frecuencia_cardiaca (lpm) · spo2 (%) · presion_sistolica (mmHg) · glucosa (mg/dL) · temperatura_central (°C) · temperatura_piel (°C) · sueno (horas) · animo (1-5) · radiacion_dosis (mGy acumulados en la misión).

**Etapas de misión:** prevuelo · lanzamiento · en_orbita · reingreso · postvuelo.

**Estado:** `tomada` (lleva valor), `fallida` o `cancelada` (sin valor).

**Reglas que aplica la base (no dependen del código):**
- El sensor debe medir ese indicador (no se acepta glucosa desde un Apple Watch).
- El valor debe caer en el rango del indicador. Los rangos solo detectan errores de captura: **no son umbrales clínicos**.
- Si la medición indica misión, debe indicar etapa, y el usuario debe participar en esa misión.
- Las mediciones **no se editan ni se borran**. Para volver a medir se crea una fila nueva con `repite_a` = id de la original, del mismo usuario e indicador.

## Puesta en marcha

### Lo que hace Back-end 1 (una sola vez)

1. En Supabase, crear o elegir el proyecto del equipo.
2. **SQL Editor → New query**: pegar y ejecutar, en orden, `001`, `002` y `003`. No se ejecutan dos veces.
3. **Authentication → Users → Add user**: crear un usuario de prueba.
4. Copiar `.env.example` como `.env` en esta carpeta y llenarlo (URL, llave publicable, usuario de prueba).
5. Instalar y probar:

```bash
cd backend/DataBase
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python prueba_conexion.py
```

6. Agregar participantes a una misión (desde el SQL Editor, como administrador):

```sql
insert into public.misiones (nombre, fecha_lanzamiento, fecha_regreso_planeada)
values ('Astra-1', '2027-03-01T12:00Z', '2027-03-15T12:00Z') returning id;

insert into public.participantes_mision (mision_id, usuario_id)
values ('<id de la misión>', '<id del usuario en Authentication>');
```

### Para Backend 2 (FastAPI)

El front-end manda `Authorization: Bearer <access_token>` en cada petición. FastAPI pasa ese token a las funciones de `mediciones.py`:

| Función | Uso |
|---|---|
| `guardar_mediciones(token, lista)` | Guarda un lote (cola offline). Reenviar el mismo `id` no duplica. |
| `guardar_medicion(token, medicion)` | Una sola. Devuelve `None` si ya existía. |
| `repetir_medicion(token, original_id, sensor_id, valor, tomada_en)` | Nueva toma enlazada a la original. |
| `consultar_mediciones(token, indicador=, desde=, hasta=, mision_id=, etapa=)` | Historial del usuario. |
| `nueva_medicion(...)` | Arma un diccionario con UUID nuevo. |

No envíen `usuario_id` ni `recibida_en`: los pone la base a partir del token.

### Para Frontend (React)

- Variables públicas: `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` (las da Back-end 1).
- Registro e inicio de sesión con `@supabase/supabase-js` ([guía oficial](https://supabase.com/docs/guides/auth/quickstarts/react)). El nombre se envía en `signUp({ email, password, options: { data: { nombre } } })` y el perfil se crea solo.
- Al llamar a FastAPI: `Authorization: Bearer ${session.access_token}`.
- Cada medición se crea en el dispositivo con `crypto.randomUUID()` como `id` (ver modo sin conexión).

## Privacidad: que nadie más entre a la base

Son cuatro capas; `.gitignore` es solo una.

1. **`.env` + `.gitignore` (las llaves no llegan a GitHub).**
   `.env` vive solo en tu computadora. `.gitignore` es la lista de archivos que Git ignora; como incluye `.env`, nunca entra en un commit. Al repo se sube `.env.example` (nombres sin valores) para que cada quien sepa qué llenar. Para comprobarlo: `git status` no debe mostrar `.env`, y `git check-ignore -v backend/DataBase/.env` debe responder con la regla que lo ignora.
   Si una llave se sube por error, borrarla no basta (queda en el historial de git): **hay que regenerarla** en Supabase → Project Settings → API Keys.

2. **Dos llaves con permisos distintos.**
   - *Publicable* (`sb_publishable_…` / `anon`): puede ir en React. Sola no da acceso a nada que RLS no permita.
   - *Secreta* (`sb_secret_…` / `service_role`): **se salta RLS**. No la usa este módulo. Nunca en React, en GitHub ni en un chat; solo para tareas de administración.

3. **RLS: la protección real.** Aunque alguien tenga la URL y la llave publicable, sin sesión no ve ninguna tabla, y con sesión solo ve sus propias mediciones y misiones.

4. **Ajustes del proyecto (Back-end 1, en el dashboard).**
   - Database → Settings → *Network Restrictions*: limitar las conexiones directas a Postgres a IPs conocidas.
   - Authentication → Sign In / Providers: dejar activos solo los métodos de registro que se usen.
   - El repositorio en GitHub debe ser **privado**.

## Modo sin conexión (offline)

Objetivo: registrar mediciones sin red (p. ej. en órbita) y subirlas después **sin perder ni duplicar** ninguna.

1. **Se crea en el dispositivo.** Cada medición recibe su `id` (UUID) y su `tomada_en` en el momento de tomarla, no al subirla.
2. **Cola local.** Se guarda en el almacenamiento del dispositivo (IndexedDB en web, SQLite en móvil) con estado local `pendiente`. La app la muestra de inmediato, aunque no haya red.
3. **Sincronización.** Al volver la conexión, la app renueva su sesión (Supabase lo hace con el refresh token) y envía la cola en lotes a FastAPI, que llama a `guardar_mediciones`.
4. **Sin duplicados.** La base hace `insert … on conflict (id) do nothing`: si un lote se reenvía porque la respuesta se perdió, las filas repetidas se ignoran.
5. **Confirmación.** Cuando el servidor responde bien, la app marca esas filas como `sincronizada` (o las borra de la cola). Si falla, quedan pendientes y se reintenta más tarde.
6. **Sin conflictos de edición.** Como las mediciones nunca se modifican, dos dispositivos no pueden pisarse cambios. Una repetición puede llegar antes que su original dentro del mismo lote: la base lo valida al final de la transacción.
7. **Dos relojes.** `tomada_en` es la hora del dispositivo; `recibida_en` la pone el servidor al llegar. Así se ve cuánto tardó en sincronizarse.

Límite a acordar con Frontend: el token de sesión expira; si el dispositivo pasa mucho tiempo sin red, debe renovar sesión antes de subir la cola (las mediciones siguen guardadas localmente).

## Fuentes de los sensores

- Astroskin / Bio-Monitor (CSA): https://www.asc-csa.gc.ca/eng/sciences/astroskin.asp
- Thermolab (ESA/DLR): https://www.esa.int/es/articles/space-fever
- Actiwatch en vuelo (Barger et al.): https://pmc.ncbi.nlm.nih.gov/articles/PMC4188436
- Dexcom G6 en Polaris Dawn: https://www.businesswire.com/news/home/20240827030657/en/Dexcom-CGM-Worn-in-Outer-Space-as-Part-of-First-of-its-Kind-Polaris-Dawn-Mission
- Apple Watch en Inspiration4: https://appleinsider.com/articles/21/09/04/spacex-mission-turns-to-apple-watch-iphone-ipad-for-health-study
- Crew Active Dosimeter (NASA SRAG): https://srag.jsc.nasa.gov/spaceradiation/how/how.cfm
- APEX / POMS (NASA): https://ntrs.nasa.gov/api/citations/20260002661/downloads/Bell_APEX_IWS_2026_final.pdf
