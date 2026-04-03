import json
import re
from dataclasses import dataclass
from time import perf_counter

from google import genai
from google.genai.types import GenerateContentConfig, HttpOptions, Part

from backend.config import GEMINI_MODEL, LOCATION, PROJECT_ID


SYSTEM_INSTRUCTION = """You interpret short ASL clips for medical or emergency triage.
The clip should contain one short sign or one very short phrase.
Your job is to identify the intended medical meaning and write one simple sentence for first responders.
Focus on meanings such as help, emergency, call 911, doctor, nurse, ambulance, pain, bleeding, choking, cannot breathe, water, and bathroom.
Be conservative.
If the clip is unclear, incomplete, off-camera, or not clearly medical/emergency-related, say it is unclear.
Return JSON only.
"""

CLASSIFIER_PROMPT = """Return JSON only with exactly these keys:
{
  "label": "",
  "sentence": "",
  "confidence": 0.0,
  "reason": ""
}

Rules:
- "label" should be a short lowercase identifier such as "help", "emergency", "doctor", or "unclear".
- "sentence" should be one short sentence for first responders describing the intended meaning in a medical context.
- If the clip is unclear, use label "unclear" and sentence "The sign was unclear - please ask the person to repeat."
- "confidence" must be between 0.0 and 1.0.
- "reason" should be a short lowercase explanation.
"""

UNCLEAR_SENTENCE = "The sign was unclear - please ask the person to repeat."

client = genai.Client(
    vertexai=True,
    project=PROJECT_ID,
    location=LOCATION,
    http_options=HttpOptions(api_version="v1"),
)


@dataclass
class TranslationResult:
    sentence: str
    raw_text: str
    finish_reason: str
    response_id: str
    model_version: str
    prompt_used: str
    label: str
    inference_ms: int
    confidence: float
    needs_retry: bool
    retry_reason: str
    analysis: dict
    votes: list[dict]


def _normalize_mime_type(mime_type: str) -> str:
    return (mime_type or "video/webm").split(";")[0].strip().lower()


def _normalize_label(value: str) -> str:
    return re.sub(r"[^a-z0-9_ ]+", "", (value or "").strip().lower()).replace(" ", "_") or "unclear"


def _normalize_sentence(value: str) -> str:
    sentence = re.sub(r"\s+", " ", str(value or "").strip())
    return sentence or UNCLEAR_SENTENCE


def _clamp_confidence(value) -> float:
    try:
        return max(0.0, min(float(value), 1.0))
    except (TypeError, ValueError):
        return 0.0


def _extract_json_object(raw_text: str) -> dict:
    text = (raw_text or "").strip()
    if not text:
        return {}

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            return {}
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return {}


def translate_video(video_bytes: bytes, mime_type: str) -> TranslationResult:
    started_at = perf_counter()
    video_part = Part.from_bytes(data=video_bytes, mime_type=_normalize_mime_type(mime_type))

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[video_part, CLASSIFIER_PROMPT],
        config=GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            temperature=0,
            max_output_tokens=200,
            media_resolution="MEDIA_RESOLUTION_MEDIUM",
            response_mime_type="application/json",
        ),
    )

    parsed = _extract_json_object(getattr(response, "text", ""))
    label = _normalize_label(parsed.get("label", "unclear"))
    sentence = _normalize_sentence(parsed.get("sentence", ""))
    confidence = _clamp_confidence(parsed.get("confidence", 0.0))
    reason = str(parsed.get("reason", "")).strip().lower()

    if label != "unclear" and confidence < 0.55:
        label = "unclear"
        sentence = UNCLEAR_SENTENCE
        reason = reason or "low_confidence"

    if label == "unclear":
        sentence = UNCLEAR_SENTENCE

    needs_retry = label == "unclear"
    if needs_retry and reason:
        sentence = f"{sentence} ({reason.replace('_', ' ')})"

    finish_reason = "UNKNOWN"
    if getattr(response, "candidates", None):
        finish_reason = str(response.candidates[0].finish_reason)

    inference_ms = int((perf_counter() - started_at) * 1000)
    vote = {
        "source": "gemini_classifier",
        "label": label,
        "confidence": confidence,
        "reason": reason,
    }

    return TranslationResult(
        sentence=sentence,
        raw_text=getattr(response, "text", ""),
        finish_reason=finish_reason,
        response_id=getattr(response, "response_id", ""),
        model_version=getattr(response, "model_version", ""),
        prompt_used="single_pass_medical_classifier",
        label=label,
        inference_ms=inference_ms,
        confidence=confidence,
        needs_retry=needs_retry,
        retry_reason=reason if needs_retry else "",
        analysis={"reason": reason},
        votes=[vote],
    )
