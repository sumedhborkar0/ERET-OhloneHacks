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
USE_HTTPS = True

GEMINI_PROMPT = """You are an emergency ASL interpreter assisting first responders.
A person is signing in American Sign Language in this video clip.
Describe what emergency they are communicating in a single clear sentence,
written in third person as if reporting to a 911 dispatcher.

Examples of good responses:
- "This person is choking and needs immediate assistance."
- "This person is reporting severe chest pain on their left side."
- "This person is asking someone to call 911 right away."
- "This person is indicating they cannot breathe."
- "This person is signing that someone has fallen and is injured."

If the signing is unclear or the video is too dark or obstructed, respond:
"The sign was unclear - please ask the person to repeat."

Rules:
- Respond with only the one sentence. No preamble, no explanation.
- Never say "the signer" - always say "this person".
- Be specific about body location if a sign indicates it (chest, head, arm).
"""
