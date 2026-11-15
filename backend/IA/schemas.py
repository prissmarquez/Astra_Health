"""Shape of an explanation, shared by Claude and the template fallback."""

from pydantic import BaseModel, Field


class Explanation(BaseModel):
    summary: str = Field(description="One or two sentences on the astronaut's overall state.")
    detail: str = Field(description="What changed and the most likely reason, using only the given facts.")
    recommendations: list[str] = Field(description="Up to 3 short, practical actions.")
