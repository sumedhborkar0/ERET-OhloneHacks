# Ohlone Hackathon 2026

## Local Run

1. Set up your `.env` with the required Vertex AI credentials and project values.
2. Start the backend from the repo root:

```powershell
python .\backend\server.py
```

3. Open `http://localhost:5000`.

## Ngrok Demo Setup

Use ngrok to expose the local Flask and Socket.IO server to a phone or any external device.

1. Install ngrok and add your auth token:

```powershell
ngrok config add-authtoken YOUR_TOKEN
```

2. Make sure local adhoc HTTPS is off for the Flask server:

```powershell
$env:USE_HTTPS="false"
```

3. In a first terminal, start the app:

```powershell
python .\run.py
```

4. In a second terminal, start ngrok:

```powershell
ngrok http 5000
```

5. Copy the `https://...ngrok-free.app` URL that ngrok prints.
6. Stop the app terminal and restart it with that public URL so the QR code points to ngrok instead of the local LAN address:

```powershell
$env:USE_HTTPS="false"
$env:PUBLIC_URL="https://your-subdomain.ngrok-free.app"
python .\run.py
```

7. Scan the QR code or open the ngrok URL on your phone.

## Notes

- The frontend and Socket.IO backend are served from the same Flask app, so no frontend URL changes are needed for ngrok.
- Camera access works through ngrok because the public URL is HTTPS.
- If you want local adhoc HTTPS again, set `USE_HTTPS=true` before starting the server.
- If you scan the local WiFi QR code while `USE_HTTPS=false`, the phone must use `http://...:5000`. If it tries `https://...:5000`, Flask will log `400 Bad request` because it is receiving TLS traffic on a plain HTTP port.
