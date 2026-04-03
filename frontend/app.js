// ─── State ───────────────────────────────────────────────────────────────────
// All mutable state lives here. Never read/write DOM to track state.
const state = {
  connected: false,        // WebSocket connection alive
  recording: false,        // MediaRecorder currently running
  mediaRecorder: null,     // Active MediaRecorder instance
  chunks: [],              // Accumulated video data chunks
  stream: null,            // Camera MediaStream
  ringInterval: null,      // setInterval handle for the progress ring animation
  ringProgress: 0,         // 0.0 → 1.0 over the 6-second max recording window
  MAX_RECORD_MS: 6000      // Hard cap on recording length
};

// ─── DOM References ───────────────────────────────────────────────────────────
// Cache all DOM lookups once. Never query the DOM inside event handlers.
const el = {
  dot:        document.getElementById("connection-dot"),
  connLabel:  document.getElementById("connection-label"),
  preview:    document.getElementById("preview"),
  recOverlay: document.getElementById("recording-overlay"),
  recordBtn:  document.getElementById("record-btn"),
  btnLabel:   document.getElementById("btn-label"),
  ringFill:   document.getElementById("ring-fill"),
  resultCard: document.getElementById("result-card"),
  resultText: document.getElementById("result-text"),
  againBtn:   document.getElementById("again-btn"),
  spinner:    document.getElementById("spinner"),
  spinLabel:  document.getElementById("spinner-label"),
};

// ─── WebSocket Setup ──────────────────────────────────────────────────────────
// Connect to the same host that served this page.
// Flask-SocketIO serves the Socket.IO client at /socket.io/socket.io.js,
// so no hardcoded IP is needed — works on any network automatically.
const socket = io();

socket.on("connect", () => {
  state.connected = true;
  el.dot.className = "connected";
  el.connLabel.textContent = "Connected";
  el.recordBtn.disabled = false;  // Only enable the button once WS is live
});

socket.on("disconnect", () => {
  state.connected = false;
  el.dot.className = "disconnected";
  el.connLabel.textContent = "Disconnected — refresh to reconnect";
  el.recordBtn.disabled = true;
});

socket.on("processing", (data) => {
  // Server confirmed it received the video and is calling Gemini.
  // Show the spinner.
  el.spinLabel.textContent = data.message;
  show(el.spinner);
});

socket.on("result", (data) => {
  // Gemini returned a sentence. Hide spinner, show the result card.
  hide(el.spinner);
  el.resultText.textContent = data.sentence;
  show(el.resultCard);
});

socket.on("error", (data) => {
  hide(el.spinner);
  el.resultText.textContent = data.message;
  el.resultCard.style.background = "#4a1a1a";  // Red tint for errors
  show(el.resultCard);
});

// ─── Camera Init ─────────────────────────────────────────────────────────────
async function initCamera() {
  try {
    // facingMode: "user" = front camera, which is correct for signing.
    // The video is mirrored in CSS (transform: scaleX(-1)) so it feels natural.
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    el.preview.srcObject = state.stream;
  } catch (err) {
    el.connLabel.textContent = "Camera permission denied — cannot run.";
    el.recordBtn.disabled = true;
  }
}

// ─── Recording ───────────────────────────────────────────────────────────────
// pointerdown/pointerup instead of mousedown/touchstart because pointer events
// work consistently across mouse, touch, and stylus on all mobile browsers.
el.recordBtn.addEventListener("pointerdown", startRecording);
el.recordBtn.addEventListener("pointerup", stopRecording);

// If the pointer leaves the button while held (e.g. finger slides off),
// stop recording so we don't get stuck in recording state.
el.recordBtn.addEventListener("pointerleave", stopRecording);

function startRecording() {
  if (!state.connected || state.recording) return;

  state.recording = true;
  state.chunks = [];

  // Choose the best supported MIME type.
  // video/webm;codecs=vp9 gives the best quality/size ratio.
  // Fallback to video/webm for older browsers.
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";

  state.mediaRecorder = new MediaRecorder(state.stream, {
    mimeType,
    videoBitsPerSecond: 500_000  // 500kbps — enough for clear hand landmarks
  });

  state.mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) state.chunks.push(e.data);
  };

  state.mediaRecorder.onstop = onRecordingStop;
  state.mediaRecorder.start(100);  // Collect data in 100ms chunks

  // UI: show recording state
  show(el.recOverlay);
  el.recordBtn.classList.add("recording");
  el.btnLabel.textContent = "Release to Send";
  hide(el.resultCard);
  el.resultCard.style.background = "#1d3557";  // Reset error tint

  // Animate the progress ring over MAX_RECORD_MS
  state.ringProgress = 0;
  const circumference = 339.3;
  const stepMs = 50;
  state.ringInterval = setInterval(() => {
    state.ringProgress += stepMs / state.MAX_RECORD_MS;
    if (state.ringProgress >= 1) {
      state.ringProgress = 1;
      stopRecording();  // Auto-stop when ring completes
    }
    const offset = circumference * (1 - state.ringProgress);
    el.ringFill.style.strokeDashoffset = offset;
  }, stepMs);
}

function stopRecording() {
  if (!state.recording) return;
  state.recording = false;

  clearInterval(state.ringInterval);
  el.ringFill.style.strokeDashoffset = 339.3;  // Reset ring
  hide(el.recOverlay);
  el.recordBtn.classList.remove("recording");
  el.btnLabel.textContent = "Hold to Sign";

  if (state.mediaRecorder?.state === "recording") {
    state.mediaRecorder.stop();
  }
}

function onRecordingStop() {
  if (state.chunks.length === 0) return;

  // Combine chunks into a single Blob
  const blob = new Blob(state.chunks, { type: "video/webm" });

  // Minimum size check — if the recording was too short (finger tap, not hold),
  // ignore it and show a hint rather than sending a useless clip to Gemini.
  if (blob.size < 5000) {
    el.resultText.textContent = "Recording too short — hold the button while signing.";
    show(el.resultCard);
    return;
  }

  // Send binary blob over WebSocket.
  // Socket.IO handles binary data natively — Blob is sent as binary frames,
  // not base64. The backend receives it as raw bytes.
  socket.emit("video_data", blob);

  // Show spinner while we wait for the server's "processing" acknowledgment
  el.spinLabel.textContent = "Sending...";
  show(el.spinner);
}

// ─── "Sign Again" button ──────────────────────────────────────────────────────
el.againBtn.addEventListener("click", () => {
  hide(el.resultCard);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function show(elem) { elem.classList.remove("hidden"); }
function hide(elem) { elem.classList.add("hidden"); }

// ─── Boot ─────────────────────────────────────────────────────────────────────
initCamera();
