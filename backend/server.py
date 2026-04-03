import json
import traceback
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO

from backend.config import DEBUG_CAPTURE_DIR, HOST, PORT, USE_HTTPS
from backend.gemini_client import translate_video

app = Flask(__name__)

CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")


def _suffix_for_mime_type(mime_type: str) -> str:
    if "mp4" in mime_type:
        return ".mp4"
    if "webm" in mime_type:
        return ".webm"
    if "quicktime" in mime_type or "mov" in mime_type:
        return ".mov"
    return ".bin"


def _write_debug_capture(video_bytes: bytes, mime_type: str, metadata: dict) -> None:
    capture_dir = Path(DEBUG_CAPTURE_DIR)
    capture_dir.mkdir(parents=True, exist_ok=True)

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    stem = capture_dir / timestamp

    video_path = stem.with_suffix(_suffix_for_mime_type(mime_type))
    metadata_path = stem.with_suffix(".json")
    latest_video_path = capture_dir / f"latest{_suffix_for_mime_type(mime_type)}"
    latest_metadata_path = capture_dir / "latest.json"

    video_path.write_bytes(video_bytes)
    latest_video_path.write_bytes(video_bytes)

    payload = json.dumps(metadata, indent=2)
    metadata_path.write_text(payload, encoding="utf-8")
    latest_metadata_path.write_text(payload, encoding="utf-8")


@socketio.on("connect")
def handle_connect():
    app.logger.info("Client connected: %s", request.sid)


@socketio.on("disconnect")
def handle_disconnect():
    app.logger.info("Client disconnected: %s", request.sid)


@app.post("/api/translate")
def translate_endpoint():
    try:
        upload = request.files.get("video")
        if upload is None:
            return jsonify({"message": "Video file is missing."}), 400

        mime_type = request.form.get("mimeType") or upload.mimetype or "video/webm"
        capture_raw = request.form.get("capture", "{}")
        try:
            capture = json.loads(capture_raw)
        except json.JSONDecodeError:
            capture = {"raw": capture_raw}

        video_bytes = upload.read()
        if not video_bytes:
            return jsonify({"message": "Video payload is empty."}), 400

        app.logger.warning(
            "Received video payload: mime=%s bytes=%s",
            mime_type,
            len(video_bytes),
        )

        result = translate_video(video_bytes, mime_type)
        metadata = {
            "mime_type": mime_type,
            "bytes": len(video_bytes),
            "capture": capture,
            "sentence": result.sentence,
            "raw_text": result.raw_text,
            "label": result.label,
            "confidence": result.confidence,
            "needs_retry": result.needs_retry,
            "retry_reason": result.retry_reason,
            "inference_ms": result.inference_ms,
            "finish_reason": result.finish_reason,
            "response_id": result.response_id,
            "model_version": result.model_version,
            "prompt_used": result.prompt_used,
            "analysis": result.analysis,
            "votes": result.votes,
        }
        _write_debug_capture(video_bytes, mime_type, metadata)
        app.logger.warning("Gemini response: %s", json.dumps(metadata))
        return jsonify(
            {
                "sentence": result.sentence,
                "label": result.label,
                "confidence": result.confidence,
                "needsRetry": result.needs_retry,
                "retryReason": result.retry_reason,
            }
        )

    except TimeoutError:
        return jsonify({"message": "Gemini took too long. Please try again."}), 504

    except Exception as e:
        app.logger.error("Translation failed: %s", e)
        app.logger.error(traceback.format_exc())
        return jsonify({"message": f"Translation failed: {e}"}), 500


@app.route("/")
def serve_index():
    return send_from_directory("../frontend", "index.html")


@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory("../frontend", filename)


if __name__ == "__main__":
    socketio.run(
        app,
        host=HOST,
        port=PORT,
        debug=True,
        allow_unsafe_werkzeug=True,
        ssl_context="adhoc" if USE_HTTPS else None,
    )
