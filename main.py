from run import app, socketio
from backend.config import HOST, PORT, USE_HTTPS


if __name__ == "__main__":
    socketio.run(
        app,
        host=HOST,
        port=PORT,
        debug=False,
        allow_unsafe_werkzeug=True,
        ssl_context="adhoc" if USE_HTTPS else None,
    )
