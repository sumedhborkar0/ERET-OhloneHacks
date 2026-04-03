from __future__ import annotations

import math
from typing import Any

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


def _point_distance(a: dict[str, Any] | None, b: dict[str, Any] | None) -> float:
    if not a or not b:
        return 0.0
    return math.sqrt((a.get("x", 0.0) - b.get("x", 0.0)) ** 2 + (a.get("y", 0.0) - b.get("y", 0.0)) ** 2)


def _compute_motion(points: list[dict[str, Any] | None]) -> float:
    distance = 0.0
    prev = None
    for point in points:
        if point and prev:
            distance += _point_distance(prev, point)
        if point:
            prev = point
    return distance


def _summarize_landmarks(landmarks: list[dict[str, Any]] | None) -> str:
    if not landmarks:
        return ""

    frames = [frame for frame in landmarks if isinstance(frame, dict)]
    if not frames:
        return ""

    total = len(frames)
    left_frames = [frame.get("left") for frame in frames if isinstance(frame.get("left"), list)]
    right_frames = [frame.get("right") for frame in frames if isinstance(frame.get("right"), list)]
    pose_frames = [frame.get("pose") for frame in frames if isinstance(frame.get("pose"), list)]
    face_frames = [frame.get("face") for frame in frames if isinstance(frame.get("face"), list)]

    left_tip_track = [hand[8] for hand in left_frames if len(hand) > 8]
    right_tip_track = [hand[8] for hand in right_frames if len(hand) > 8]
    left_motion = _compute_motion(left_tip_track)
    right_motion = _compute_motion(right_tip_track)

    hand_near_face = 0
    checked_near_face = 0
    for frame in frames:
        face = frame.get("face")
        mouth = face[0] if isinstance(face, list) and face else None
        if not mouth:
            continue

        left = frame.get("left")
        right = frame.get("right")
        left_tip = left[8] if isinstance(left, list) and len(left) > 8 else None
        right_tip = right[8] if isinstance(right, list) and len(right) > 8 else None
        checked_near_face += 1
        left_near = bool(left_tip and _point_distance(left_tip, mouth) < 0.14)
        right_near = bool(right_tip and _point_distance(right_tip, mouth) < 0.14)
        if left_near or right_near:
            hand_near_face += 1

    near_face_ratio = (hand_near_face / checked_near_face) if checked_near_face else 0.0
    left_ratio = len(left_frames) / total
    right_ratio = len(right_frames) / total
    pose_ratio = len(pose_frames) / total
    face_ratio = len(face_frames) / total

    return (
        "MediaPipe Holistic context:\n"
        f"- Frames sampled: {total}\n"
        f"- Left hand visible: {left_ratio:.0%}\n"
        f"- Right hand visible: {right_ratio:.0%}\n"
        f"- Pose visible: {pose_ratio:.0%}\n"
        f"- Face visible: {face_ratio:.0%}\n"
        f"- Left index fingertip movement (normalized): {left_motion:.3f}\n"
        f"- Right index fingertip movement (normalized): {right_motion:.3f}\n"
        f"- Hand near mouth ratio: {near_face_ratio:.0%}\n"
        "Use this only as supporting motion context. Prioritize the video itself."
    )


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


def _generate_sentence(video_bytes: bytes, mime_type: str, prompt: str, landmark_context: str = "") -> str:
    contents: list[Any] = [prompt]
    if landmark_context:
        contents.append(landmark_context)
    contents.append(Part.from_bytes(data=video_bytes, mime_type=mime_type))

    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=contents,
        config=GenerateContentConfig(
            temperature=0.1,
            max_output_tokens=256,
            response_mime_type="text/plain",
        ),
    )
    return _cleanup_sentence(_extract_text(response))


def translate_video(video_bytes: bytes, mime_type: str, landmarks: list[dict[str, Any]] | None = None) -> str:
    normalized_mime_type = normalize_mime_type(mime_type)
    landmark_context = _summarize_landmarks(landmarks)

    try:
        sentence = _generate_sentence(video_bytes, normalized_mime_type, GEMINI_PROMPT, landmark_context)
        if not _is_complete_sentence(sentence):
            sentence = _generate_sentence(
                video_bytes,
                normalized_mime_type,
                f"{GEMINI_PROMPT}\n\n{RETRY_PROMPT_SUFFIX}",
                landmark_context,
            )
    except errors.ClientError as exc:
        raise ValueError(
            f"Gemini rejected the {normalized_mime_type} upload. "
            "Try recording again with a short, clear clip."
        ) from exc

    if not _is_complete_sentence(sentence):
        return "Please try again."

    return sentence
