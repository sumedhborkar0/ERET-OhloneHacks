from google import genai
from google.genai.types import GenerateContentConfig, HttpOptions, Part

from backend.config import GEMINI_MODEL, GEMINI_PROMPT, LOCATION, PROJECT_ID


client = genai.Client(
    vertexai=True,
    project=PROJECT_ID,
    location=LOCATION,
    http_options=HttpOptions(api_version="v1"),
)


def translate_video(video_bytes: bytes, mime_type: str) -> str:
    response = client.models.generate_content(
        model=GEMINI_MODEL,
        contents=[
            Part.from_bytes(data=video_bytes, mime_type=mime_type),
            GEMINI_PROMPT,
        ],
        config=GenerateContentConfig(
            temperature=0.1,
            max_output_tokens=150,
        ),
    )

    return response.text.strip()
