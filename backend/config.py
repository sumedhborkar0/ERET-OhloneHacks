import os

from dotenv import load_dotenv

load_dotenv()

# Vertex AI
PROJECT_ID = os.getenv("PROJECT_ID", "project-e8d0f587-1b9b-444c-b58")
LOCATION = os.getenv("LOCATION", "global")
# `gemini-3.1-pro` is not available to this Vertex project. Default to the
# strongest verified model that succeeds here, while still allowing override.
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-pro")

# Server
HOST = "0.0.0.0"
PORT = 5000
USE_HTTPS = os.getenv("USE_HTTPS", "false").strip().lower() in {"1", "true", "yes", "on"}
PUBLIC_URL = os.getenv("PUBLIC_URL", "").strip()
AUTO_START_NGROK = os.getenv("AUTO_START_NGROK", "true").strip().lower() in {"1", "true", "yes", "on"}
NGROK_PATH = os.getenv("NGROK_PATH", "").strip()

GEMINI_PROMPT = """You are an emergency ASL interpreter assisting first responders.
A person is signing a single word/phrase. Find the word or phrase. It is an emergency context.

Examples of good responses:
- "This person is choking."
- "This person has fallen."
- "This person is saying to stop."


- It is an emergency medical situation
- The MOST frequent examples include: emergency, stop, dizziness, fatigue, burn, choking, injury, vomit, fever, chills, headache, trouble breathing, doctor, nurse, falls, bleeding, stomach ache, gunshot, help, or another health condition.
If the signing is unclear or the video is too dark or obstructed, respond:
"Please try again."
DO NOT HALLUCINATE. IF YOU ARE UNSURE, WRITE THE PHRASE: "Please try again."

Rules:
- Respond with only the one sentence. No preamble, no explanation.
- If the signing suggests a concrete injury, prefer the injury itself over vague phrasing like "needs help."
- If the signing seems understandable but clearly not emergency-related at all, respond with exactly: "Please try again."
- Do not respond with non-emergency-related responses.
- The sentence must be complete and end with a period.
- Do not output fragments such as "This person is signing that they" or any sentence that ends mid-thought.
- If you are not confident or the sentence would be incomplete, respond with exactly: "Please try again."
"""
