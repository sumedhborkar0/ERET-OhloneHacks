ASL Translator - Ohlone Hackathon 2026

Project Overview

This is an American Sign Language (ASL) Translator designed specifically for hospital and emergency service environments.** The core purpose of this project is to use real-time mobile camera access and AI to bridge the communication gap between medical professionals and deaf or hard-of-hearing patients during critical moments. 

 Important Capability Note:** This application is built for rapid emergency communication and currently **only translates individual words or short phrases (e.g., "stop," "help," "fever"). It does *not* translate continuous, full-sentence ASL conversations.

About the Repository
This repository contains the web application built for the **Ohlone Hackathon 2026**. 

 Key Features
* **Emergency-Focused Translation:** Specifically trained to recognize high-priority ASL words and phrases used in medical settings.
* **Live Camera Access:** Utilizes HTTPS tunneling to securely request and access the mobile device's camera to read ASL signs.
* **Vertex AI Integration:** Connects to Google Cloud's Vertex AI to power the core artificial intelligence translation features.
* **Real-time Communication:** Implements Socket.IO to handle live data streaming between the frontend and the backend.

Tech Stack
* **Backend:** Python, Flask, Socket.IO
* **Frontend:** JavaScript, HTML, CSS
* **Cloud & AI:** Google Cloud Vertex AI
* **Tools:** Ngrok (for local server exposure)
