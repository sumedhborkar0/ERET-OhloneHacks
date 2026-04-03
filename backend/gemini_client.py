from __future__ import annotations

from google import genai
from google.genai import errors
from google.genai.types import GenerateContentConfig, HttpOptions, Part

from backend.config import GEMINI_MODEL, GEMINI_PROMPT, LOCATION, PROJECT_ID


client = genai.Client(
    vertexai=True,
    project=PROJECT_ID,
    location=LOCATION,
    http_options=HttpOptions(api_version="v1"),
)


def normalize_mime_type(mime_type: str | None) -> str:
    if not mime_type:
        return "video/webm"

    return mime_type.split(";", 1)[0].strip().lower() or "video/webm"


def _extract_text(response) -> str:
    text = (getattr(response, "text", None) or "").strip()
    if text:
        return text

    for candidate in getattr(response, "candidates", []) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", []) or []:
            part_text = (getattr(part, "text", None) or "").strip()
            if part_text:
                return part_text

    raise ValueError("Gemini returned an empty response.")


def translate_video(video_bytes: bytes, mime_type: str) -> str:
    normalized_mime_type = normalize_mime_type(mime_type)

    try:
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=[
                GEMINI_PROMPT,
                Part.from_bytes(data=video_bytes, mime_type=normalized_mime_type),
            ],
            config=GenerateContentConfig(
                temperature=0.1,
                max_output_tokens=256,
                response_mime_type="text/plain",
            ),
        )
    except errors.ClientError as exc:
        raise ValueError(
            f"Gemini rejected the {normalized_mime_type} upload. "
            "Try recording again with a short, clear clip."
        ) from exc

    return _extract_text(response)
