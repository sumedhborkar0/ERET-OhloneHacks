import socket
import qrcode
from backend.server import socketio, app
from backend.config import HOST, PORT

if __name__ == "__main__":
    # Detect the machine's local WiFi IP automatically.
    # Connecting to 8.8.8.8 never actually sends a packet — it's a trick to
    # get the OS to tell us which interface (and IP) it would use for routing.
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        local_ip = s.getsockname()[0]
    finally:
        s.close()

    url = f"http://{local_ip}:{PORT}"

    print("\n" + "─" * 40)
    print(f"  ASL Emergency Translator")
    print(f"  Server: {url}")
    print("─" * 40)

    # Print QR code in the terminal so phones can connect by scanning
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.print_ascii(invert=True)

    print("  Scan the code above on any phone on this WiFi.")
    print("─" * 40 + "\n")

    socketio.run(app, host=HOST, port=PORT, debug=False, allow_unsafe_werkzeug=True)
