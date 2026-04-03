import atexit
import json
import os
import shutil
import socket
import subprocess
import threading
import time
from urllib.error import URLError
from urllib.request import urlopen

import qrcode

from backend.server import app, socketio
from backend.config import AUTO_START_NGROK, HOST, NGROK_PATH, PORT, PUBLIC_URL, USE_HTTPS


def detect_ngrok_url() -> tuple[str, str]:
    try:
        with urlopen("http://127.0.0.1:4040/api/tunnels", timeout=1.5) as response:
            payload = json.load(response)
    except (URLError, TimeoutError, OSError, json.JSONDecodeError):
        return "", "not detected"

    tunnels = payload.get("tunnels", [])
    for tunnel in tunnels:
        public_url = (tunnel.get("public_url") or "").strip()
        if public_url.startswith("https://"):
            return public_url, "connected"

    for tunnel in tunnels:
        public_url = (tunnel.get("public_url") or "").strip()
        if public_url:
            return public_url, "connected"

    return "", "no active tunnels"


def find_ngrok_executable() -> str:
    if NGROK_PATH and os.path.exists(NGROK_PATH):
        return NGROK_PATH

    detected = shutil.which("ngrok")
    if detected:
        return detected

    fallback = (
        r"C:\Users\Sumedh\AppData\Local\Microsoft\WinGet\Packages"
        r"\Ngrok.Ngrok_Microsoft.Winget.Source_8wekyb3d8bbwe\ngrok.exe"
    )
    if os.path.exists(fallback):
        return fallback

    return ""


def start_ngrok_tunnel() -> tuple[subprocess.Popen | None, str]:
    ngrok_executable = find_ngrok_executable()
    if not ngrok_executable:
        return None, "executable not found"

    target = f"https://localhost:{PORT}" if USE_HTTPS else str(PORT)
    creation_flags = 0
    if os.name == "nt":
        creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)

    try:
        process = subprocess.Popen(
            [ngrok_executable, "http", target, "--log", "stdout"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=creation_flags,
        )
    except OSError:
        return None, "failed to start"

    atexit.register(_stop_process, process)
    return process, "starting"


def _stop_process(process: subprocess.Popen) -> None:
    if process.poll() is None:
        process.terminate()


def wait_for_ngrok_url(timeout_seconds: float = 10.0) -> tuple[str, str]:
    deadline = time.time() + timeout_seconds
    last_status = "not detected"

    while time.time() < deadline:
        public_url, status = detect_ngrok_url()
        if public_url:
            return public_url, "connected"
        last_status = status
        time.sleep(0.5)

    return "", last_status


def watch_ngrok_url() -> None:
    printed_public_url = ""
    printed_status = ""

    while True:
        detected_public_url, detected_status = detect_ngrok_url()
        public_url = PUBLIC_URL or detected_public_url
        status = "manual override" if PUBLIC_URL else detected_status
        if public_url and public_url != printed_public_url:
            printed_public_url = public_url
            print(f"  Public: {public_url}")
            print("  Scan the ngrok URL or restart to refresh the QR code.")
            print("-" * 40)
        elif not public_url and status != printed_status:
            printed_status = status
            print("  Ngrok: not detected. Start `ngrok http 5000` after configuring your authtoken.")
            print("-" * 40)
        time.sleep(2)


if __name__ == "__main__":
    # Detect the machine's local WiFi IP automatically.
    # Connecting to 8.8.8.8 never actually sends a packet - it's a trick to
    # get the OS to tell us which interface (and IP) it would use for routing.
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
    finally:
        s.close()

    scheme = "https" if USE_HTTPS else "http"
    local_url = f"{scheme}://{local_ip}:{PORT}"
    ngrok_url, ngrok_status = detect_ngrok_url()
    auto_started_ngrok = False
    if not PUBLIC_URL and not ngrok_url and AUTO_START_NGROK:
        _, start_status = start_ngrok_tunnel()
        auto_started_ngrok = start_status == "starting"
        ngrok_url, ngrok_status = wait_for_ngrok_url()
        if not ngrok_url and start_status != "starting":
            ngrok_status = start_status

    public_url = PUBLIC_URL or ngrok_url
    url = public_url or local_url

    print("\n" + "-" * 40)
    print("  ASL Emergency Translator")
    print(f"  Local:  {local_url}")
    if public_url:
        print(f"  Public: {public_url}")
    else:
        status_message = "manual override missing"
        if not PUBLIC_URL:
            if ngrok_status == "no active tunnels":
                status_message = "running, but no active tunnels are available."
            elif ngrok_status == "executable not found":
                status_message = "not installed. Install ngrok or set NGROK_PATH."
            elif ngrok_status == "failed to start":
                status_message = "failed to start automatically."
            else:
                status_message = "not detected. Start `ngrok http 5000` after configuring your authtoken."
        print(f"  Ngrok:  {status_message}")
    if auto_started_ngrok:
        print("  Tunnel: auto-started by run.py")
    print("-" * 40)

    # Print a simple ASCII QR code in the terminal so phones can connect by scanning.
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    matrix = qr.get_matrix()
    for row in matrix:
        print("".join("##" if cell else "  " for cell in row))

    if public_url:
        print("  Scan the code above to open the ngrok URL.")
    else:
        print("  Scan the code above on any phone on this WiFi.")
    print("-" * 40 + "\n")

    threading.Thread(target=watch_ngrok_url, daemon=True).start()

    socketio.run(
        app,
        host=HOST,
        port=PORT,
        debug=False,
        allow_unsafe_werkzeug=True,
        ssl_context="adhoc" if USE_HTTPS else None,
    )
