# ASL Translator - Ohlone Hackathon 2026

## Project Overview
**This is an American Sign Language (ASL) Translator designed specifically for hospital and emergency service environments.** The core purpose of this project is to use real-time mobile camera access and AI to bridge the communication gap between medical professionals and deaf or hard-of-hearing patients during critical moments. 

**⚠️ Important Capability Note:** This application is built for rapid emergency communication and currently **only translates individual words or short phrases** (e.g., "pain," "help," "water"). It does *not* translate continuous, full-sentence ASL conversations.

## About the Repository
This repository contains the web application built for the **Ohlone Hackathon 2026**. It features a unified frontend and backend architecture designed to be easily accessed on external mobile devices. By generating a local QR code, users can instantly connect their smartphones to the application, granting device camera access to process real-world visual inputs through Google Cloud's Vertex AI.

### Key Features
* **Emergency-Focused Translation:** Specifically trained to recognize high-priority ASL words and phrases used in medical settings.
* **Mobile-to-Local Connectivity:** Generates a QR code so users can instantly connect their smartphone to the local server.
* **Live Camera Access:** Utilizes HTTPS tunneling to securely request and access the mobile device's camera to read ASL signs.
* **Vertex AI Integration:** Connects to Google Cloud's Vertex AI to power the core artificial intelligence translation features.
* **Real-time Communication:** Implements Socket.IO to handle live data streaming between the frontend and the backend.

### Tech Stack
* **Backend:** Python, Flask, Socket.IO
* **Frontend:** JavaScript, HTML, CSS
* **Cloud & AI:** Google Cloud Vertex AI
* **Tools:** Ngrok (for local server exposure)

---

## Local Run

1. Set up your `.env` file with the required Vertex AI credentials and project values.
2. Start the backend from the repo root:

```bash
python .\backend\server.py
