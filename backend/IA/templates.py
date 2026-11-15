"""Fallback explanation built only from the ML output, without any AI.

Used when Claude is disabled, unreachable, out of credit or refuses. It is
less natural but always available, and it never invents data: it only
repeats what the ML found and the context stored in the database.
"""

from schemas import Explanation

TEXT = {
    "en": {
        "green": "Your body is stable overall.",
        "yellow": "Something needs attention: a value is outside your usual range.",
        "red": "Alert: at least one value is outside the safe range.",
        "startup": "There are only a few days of history, so only medical thresholds were checked.",
        "reasons": "Medical thresholds crossed: {}.",
        "deviations": "Different from your usual values: {}.",
        "connections": "Possible link: {}.",
        "ml": "The anomaly model also flagged this reading.",
        "exercising": "You recorded exercise, so a higher temperature and heart rate are expected.",
        "nothing": "No values outside your usual range.",
        "rec_green": "Keep your routine and take the next reading on time.",
        "rec_yellow": "Rest for a few minutes and repeat the reading.",
        "rec_red": "Contact the mission medical team now.",
        "rec_exercise": "Repeat the reading after resting 15-30 minutes.",
        "rec_hydrate": "Stay hydrated.",
    },
    "es": {
        "green": "Tu cuerpo se encuentra estable en general.",
        "yellow": "Algo requiere atención: un valor está fuera de tu rango habitual.",
        "red": "Alerta: al menos un valor está fuera del rango seguro.",
        "startup": "Todavía hay pocos días de historial, así que solo se revisaron los umbrales médicos.",
        "reasons": "Umbrales médicos superados: {}.",
        "deviations": "Diferente a tus valores habituales: {}.",
        "connections": "Posible relación: {}.",
        "ml": "El modelo de anomalías también marcó esta lectura.",
        "exercising": "Registraste ejercicio, así que es esperable una temperatura y frecuencia cardíaca más altas.",
        "nothing": "Ningún valor fuera de tu rango habitual.",
        "rec_green": "Mantén tu rutina y toma tu próximo registro a tiempo.",
        "rec_yellow": "Descansa unos minutos y repite la medición.",
        "rec_red": "Contacta ahora al equipo médico de la misión.",
        "rec_exercise": "Repite la medición después de descansar 15-30 minutos.",
        "rec_hydrate": "Mantente hidratado.",
    },
}


def template_explanation(analysis: dict, context: dict, language: str = "en") -> Explanation:
    t = TEXT.get(language, TEXT["en"])
    light = analysis.get("traffic_light", "green")
    exercising = bool(context.get("exercising", False))

    parts = []
    if str(analysis.get("mode", "")).startswith("startup"):
        parts.append(t["startup"])
    if analysis.get("clinical_reasons"):
        parts.append(t["reasons"].format(", ".join(analysis["clinical_reasons"])))
    if analysis.get("deviations"):
        parts.append(t["deviations"].format(", ".join(analysis["deviations"])))
    for link in analysis.get("connections") or []:
        parts.append(t["connections"].format(link))
    if analysis.get("detected_by_ml"):
        parts.append(t["ml"])
    if exercising:
        parts.append(t["exercising"])
    if not parts:
        parts.append(t["nothing"])

    recommendations = [t[f"rec_{light}"]]
    if exercising and light != "red":
        recommendations.append(t["rec_exercise"])
    recommendations.append(t["rec_hydrate"])

    return Explanation(
        summary=t[light],
        detail=" ".join(parts),
        recommendations=recommendations[:3],
    )
