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

RETRY_PROMPT_SUFFIX = """
The first answer was incomplete or ended mid-thought.
Try again and return exactly one complete sentence ending with a period.
If uncertain, return exactly: "Please try again."
"""

_DANGLING_ENDINGS = {
    "a",
    "an",
    "the",
    "that",
    "that they",
    "they",
    "there",
    "there is",
    "there are",
    "to",
    "for",
    "with",
    "and",
    "or",
    "but",
    "if",
    "because",
    "their",
    "his",
    "her",
    "someone",
    "something",
    "is",
    "are",
    "was",
    "were",
    "has",
    "have",
    "had",
}


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


def _cleanup_sentence(text: str) -> str:
    return " ".join(text.strip().split())


def _is_complete_sentence(text: str) -> bool:
    sentence = " ".join(text.strip().split())
    if not sentence:
        return False

    lower_sentence = sentence.lower().rstrip(".!? ,")
    if lower_sentence == "please try again":
        return True

    if not lower_sentence.startswith("this person"):
        return False

    if sentence[-1] not in ".!?":
        return False

    words = lower_sentence.split()
    if len(words) < 4:
        return False

    if len(words) >= 3:
        tail3 = " ".join(words[-3:])
        if tail3 in _DANGLING_ENDINGS:
            return False

    tail = " ".join(words[-2:])
    if tail in _DANGLING_ENDINGS or words[-1] in _DANGLING_ENDINGS:
        return False

    return True


def _generate_sentence(video_bytes: bytes, mime_type: str, prompt: str) -> str:
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[
            prompt,
            Part.from_bytes(data=video_bytes, mime_type=mime_type),
        ],
        config=GenerateContentConfig(
            temperature=0.1,
            max_output_tokens=256,
            response_mime_type="text/plain",
        ),
    )
    return _cleanup_sentence(_extract_text(response))


def translate_video(video_bytes: bytes, mime_type: str) -> str:
    normalized_mime_type = normalize_mime_type(mime_type)

    try:
        sentence = _generate_sentence(video_bytes, normalized_mime_type, GEMINI_PROMPT)
        if not _is_complete_sentence(sentence):
            sentence = _generate_sentence(
                video_bytes,
                normalized_mime_type,
                f"{GEMINI_PROMPT}\n\n{RETRY_PROMPT_SUFFIX}",
            )
    except errors.ClientError as exc:
        raise ValueError(
            f"Gemini rejected the {normalized_mime_type} upload. "
            "Try recording again with a short, clear clip."
        ) from exc

    if not _is_complete_sentence(sentence):
        return "Please try again."

    return sentence
