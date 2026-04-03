import traceback

from flask import Flask, request, send_from_directory
from flask_cors import CORS
from flask_socketio import SocketIO, emit

from backend.config import HOST, PORT, USE_HTTPS
from backend.gemini_client import translate_video

app = Flask(__name__)

CORS(app, resources={r"/*": {"origins": "*"}})
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")


@socketio.on("connect")
def handle_connect():
    app.logger.info("Client connected: %s", request.sid)


@socketio.on("disconnect")
def handle_disconnect():
    app.logger.info("Client disconnected: %s", request.sid)


@socketio.on("video_data")
def handle_video(data):
    emit("processing", {"message": "Translating your sign..."})

    try:
        if not isinstance(data, dict):
            raise ValueError("Invalid payload format.")

        video_bytes = data.get("video")
        mime_type = data.get("mimeType", "video/webm")

        if not isinstance(video_bytes, (bytes, bytearray)):
            raise ValueError("Video payload is missing.")

        sentence = translate_video(bytes(video_bytes), mime_type)
        emit("result", {"sentence": sentence})

    except TimeoutError:
        emit("error", {"message": "Gemini took too long. Please try again."})

    except Exception as e:
        app.logger.error("Translation failed: %s", e)
        app.logger.error(traceback.format_exc())
        emit("error", {"message": f"Translation failed: {e}"})


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
