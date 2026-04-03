from flask import Flask, send_from_directory, request
from flask_socketio import SocketIO, emit
from flask_cors import CORS
from gemini_client import translate_video
from config import HOST, PORT

app = Flask(__name__)

# CORS is required so the browser frontend (which may be served from a
# different port during development) can connect to this SocketIO server.
# In production (same origin), this is a no-op.
CORS(app, resources={r"/*": {"origins": "*"}})

# async_mode="threading" is important here. The default eventlet/gevent
# modes can conflict with the google-generativeai SDK's HTTP calls.
# Threading mode is simpler and sufficient for a hackathon single-server setup.
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")


@socketio.on("connect")
def handle_connect():
    """
    Fires when a client opens a WebSocket connection.
    We don't need to do anything here for the base product,
    but it's useful to log so you can confirm phones are connecting.
    """
    print(f"[+] Client connected: {request.sid}")


@socketio.on("disconnect")
def handle_disconnect():
    print(f"[-] Client disconnected: {request.sid}")


@socketio.on("video_data")
def handle_video(data):
    """
    Main event handler. Receives raw video bytes from the client,
    sends them to Gemini, and emits the result back.

    `data` arrives as bytes when the client emits a binary Blob via Socket.IO.
    Socket.IO automatically handles binary — no base64 encoding needed.
    """

    # Tell the client we received the video and are working on it.
    # This triggers the "Translating..." spinner on the frontend.
    emit("processing", {"message": "Translating your sign..."})

    try:
        sentence = translate_video(data)
        emit("result", {"sentence": sentence})

    except TimeoutError:
        emit("error", {"message": "Gemini took too long. Please try again."})

    except Exception as e:
        print(f"[ERROR] Translation failed: {e}")
        emit("error", {"message": "Translation failed. Please try again."})


# Serve the frontend files directly from Flask so everything runs
# on one port and there's no separate static file server needed.
@app.route("/")
def serve_index():
    return send_from_directory("../frontend", "index.html")

@app.route("/<path:filename>")
def serve_static(filename):
    return send_from_directory("../frontend", filename)


if __name__ == "__main__":
    socketio.run(app, host=HOST, port=PORT, debug=True, allow_unsafe_werkzeug=True)
