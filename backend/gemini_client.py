import os
import tempfile
import time
import google.generativeai as genai
from config import GEMINI_API_KEY, GEMINI_MODEL, GEMINI_PROMPT

genai.configure(api_key=GEMINI_API_KEY)
model = genai.GenerativeModel(GEMINI_MODEL)


def translate_video(video_bytes: bytes) -> str:
    """
    Takes raw video bytes (WebM format from the browser MediaRecorder).
    Uploads to Gemini Files API, waits for processing, runs inference,
    returns a single translated sentence.

    The Gemini Files API requires a file on disk — it cannot accept raw bytes
    directly — so we write to a named temp file, upload it, then delete it.
    """

    # Step 1: Write bytes to a temp file on disk
    # delete=False is required because Gemini SDK needs to open the file
    # by path — on Windows an open NamedTemporaryFile can't be reopened
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(video_bytes)
        tmp_path = tmp.name

    try:
        # Step 2: Upload to Gemini Files API
        # This returns a File object with a URI Gemini can reference
        uploaded_file = genai.upload_file(
            path=tmp_path,
            mime_type="video/webm",
            display_name="asl_sign.webm"
        )

        # Step 3: Wait for Gemini to finish processing the video
        # The Files API is async — the file enters a PROCESSING state and
        # must reach ACTIVE before you can use it in generate_content.
        # This loop polls every second and times out after 30 seconds.
        max_wait = 30
        waited = 0
        while uploaded_file.state.name == "PROCESSING":
            if waited >= max_wait:
                raise TimeoutError("Gemini file processing timed out.")
            time.sleep(1)
            waited += 1
            uploaded_file = genai.get_file(uploaded_file.name)

        if uploaded_file.state.name == "FAILED":
            raise ValueError("Gemini file processing failed.")

        # Step 4: Run inference — pass the video file reference + prompt
        response = model.generate_content(
            [uploaded_file, GEMINI_PROMPT],
            generation_config=genai.types.GenerationConfig(
                temperature=0.1,       # Near-deterministic — we want consistent output
                max_output_tokens=150  # One sentence never needs more than this
            )
        )

        # Step 5: Clean up the uploaded file from Gemini's storage
        # Each free-tier account has a storage quota — clean up to avoid hitting it
        genai.delete_file(uploaded_file.name)

        return response.text.strip()

    finally:
        # Always delete the local temp file, even if an exception was raised
        os.unlink(tmp_path)
