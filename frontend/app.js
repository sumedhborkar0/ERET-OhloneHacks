const state = {
  connected: false,
  recording: false,
  mediaRecorder: null,
  chunks: [],
  stream: null,
  trackSettings: null,
  ringInterval: null,
  ringProgress: 0,
  maxRecordMs: 10000,
  minRecordMs: 1200,
  recordingStartedAt: 0,
  preferredFacingMode: "user",
};

const el = {
  dot: document.getElementById("connection-dot"),
  connLabel: document.getElementById("connection-label"),
  preview: document.getElementById("preview"),
  recOverlay: document.getElementById("recording-overlay"),
  recordBtn: document.getElementById("record-btn"),
  btnLabel: document.getElementById("btn-label"),
  ringFill: document.getElementById("ring-fill"),
  resultCard: document.getElementById("result-card"),
  resultText: document.getElementById("result-text"),
  resultMeta: document.getElementById("result-meta"),
  againBtn: document.getElementById("again-btn"),
  spinner: document.getElementById("spinner"),
  spinLabel: document.getElementById("spinner-label"),
  hintText: document.getElementById("hint-text"),
  cameraBtn: document.getElementById("camera-btn"),
};

let socket = null;

if (typeof window.io !== "function") {
  el.dot.className = "disconnected";
  el.connLabel.textContent = "Socket client failed to load.";
} else {
  socket = window.io({
    transports: ["polling", "websocket"],
  });

  socket.on("connect", () => {
    state.connected = true;
    el.dot.className = "connected";
    el.connLabel.textContent = "Connected";
    el.recordBtn.disabled = false;
  });

  socket.on("connect_error", (err) => {
    state.connected = false;
    el.dot.className = "disconnected";
    el.connLabel.textContent = `Connection failed: ${err.message}`;
    el.recordBtn.disabled = true;
  });

  socket.on("disconnect", () => {
    state.connected = false;
    el.dot.className = "disconnected";
    el.connLabel.textContent = "Disconnected - refresh to reconnect";
    el.recordBtn.disabled = true;
  });
}

async function initCamera() {
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: state.preferredFacingMode },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
      audio: false,
    });
    const [track] = state.stream.getVideoTracks();
    state.trackSettings = track ? track.getSettings() : null;
    el.preview.srcObject = state.stream;
    el.preview.classList.toggle("mirror-preview", state.preferredFacingMode === "user");
    updateHint("Keep both hands and your upper body fully inside the frame.");
  } catch (err) {
    el.connLabel.textContent = `Camera unavailable: ${err.message}`;
    el.recordBtn.disabled = true;
  }
}

function toggleRecording() {
  if (state.recording) {
    stopRecording();
    return;
  }
  startRecording();
}

el.recordBtn.addEventListener("click", toggleRecording);

el.cameraBtn.addEventListener("click", async () => {
  state.preferredFacingMode = state.preferredFacingMode === "user" ? "environment" : "user";
  el.cameraBtn.textContent = state.preferredFacingMode === "user" ? "Use Rear Camera" : "Use Front Camera";
  updateHint("Switching camera...");
  await initCamera();
});

function startRecording() {
  if (!state.connected || state.recording || !state.stream) {
    return;
  }

  state.recording = true;
  state.chunks = [];

  const mimeType = pickSupportedMimeType();
  if (!mimeType) {
    state.recording = false;
    showFailure("This browser cannot record a supported video format.");
    return;
  }

  try {
    state.mediaRecorder = new MediaRecorder(state.stream, {
      mimeType,
      videoBitsPerSecond: 6000000,
    });
  } catch (err) {
    state.recording = false;
    showFailure(`Recorder failed: ${err.message}`);
    return;
  }

  state.mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      state.chunks.push(e.data);
    }
  };

  state.mediaRecorder.onstop = onRecordingStop;
  state.recordingStartedAt = Date.now();
  state.mediaRecorder.start(200);

  show(el.recOverlay);
  el.recordBtn.classList.add("recording");
  el.btnLabel.textContent = "Tap to Send";
  hide(el.resultCard);
  el.resultCard.style.background = "#1d3557";

  updateHint("Record one complete sign, then tap again to submit.");

  state.ringProgress = 0;
  const circumference = 339.3;
  const stepMs = 50;
  state.ringInterval = setInterval(() => {
    state.ringProgress += stepMs / state.maxRecordMs;
    if (state.ringProgress >= 1) {
      state.ringProgress = 1;
      stopRecording();
    }
    const offset = circumference * (1 - state.ringProgress);
    el.ringFill.style.strokeDashoffset = offset;
  }, stepMs);
}

function stopRecording() {
  if (!state.recording) {
    return;
  }

  state.recording = false;
  clearInterval(state.ringInterval);
  el.ringFill.style.strokeDashoffset = 339.3;
  hide(el.recOverlay);
  el.recordBtn.classList.remove("recording");
  el.btnLabel.textContent = "Tap to Record";

  if (state.mediaRecorder && state.mediaRecorder.state === "recording") {
    state.mediaRecorder.stop();
  }
}

function onRecordingStop() {
  if (state.chunks.length === 0) {
    return;
  }

  const mimeType = state.mediaRecorder && state.mediaRecorder.mimeType
    ? state.mediaRecorder.mimeType
    : state.chunks[0].type || "video/webm";
  const blob = new Blob(state.chunks, { type: mimeType });
  const durationMs = Math.max(0, Date.now() - state.recordingStartedAt);

  if (durationMs < state.minRecordMs) {
    showFailure(`Recording too short. Sign for at least ${(state.minRecordMs / 1000).toFixed(1)} seconds.`);
    updateHint("Start recording, complete one sign, then tap send.");
    return;
  }

  if (blob.size < 12000) {
    showFailure("Video quality was too low. Try again with your hands centered and fully visible.");
    updateHint("Stand farther back if your hands are leaving the frame.");
    return;
  }

  el.spinLabel.textContent = "Uploading...";
  show(el.spinner);
  updateHint("Processing clip...");

  const formData = new FormData();
  formData.append("video", blob, `recording.${mimeType.includes("mp4") ? "mp4" : "webm"}`);
  formData.append("mimeType", mimeType);
  formData.append("capture", JSON.stringify({
    durationMs,
    chunkCount: state.chunks.length,
    bytes: blob.size,
    trackSettings: state.trackSettings,
    preferredFacingMode: state.preferredFacingMode,
  }));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 90000);

  fetch("/api/translate", {
    method: "POST",
    body: formData,
    signal: controller.signal,
  }).then(async (response) => {
    clearTimeout(timeoutId);
    const payload = await response.json().catch(() => ({}));
    hide(el.spinner);

    if (!response.ok) {
      throw new Error(payload.message || `Upload failed with status ${response.status}`);
    }

    const confidence = typeof payload.confidence === "number"
      ? `${Math.round(payload.confidence * 100)}% confidence`
      : "";

    el.resultText.textContent = payload.sentence || "The sign was unclear - please ask the person to repeat.";
    el.resultMeta.textContent = payload.needsRetry
      ? "Low-confidence read. Try again with a single clear sign."
      : confidence;
    el.resultCard.style.background = payload.needsRetry ? "#4a1a1a" : "#1d3557";
    show(el.resultCard);

    updateHint(payload.needsRetry
      ? "Retry with one clear sign and keep both hands visible."
      : "Ready for the next sign.");
  }).catch((err) => {
    clearTimeout(timeoutId);
    hide(el.spinner);
    const message = err.name === "AbortError"
      ? "Upload timed out. Please try again."
      : err.message;
    showFailure(message);
    updateHint("Check framing and try another clip.");
  });
}

function pickSupportedMimeType() {
  const candidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4",
  ];

  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }

  return "";
}

el.againBtn.addEventListener("click", () => {
  hide(el.resultCard);
  updateHint("Record one complete sign when ready.");
});

function showFailure(message) {
  hide(el.spinner);
  el.resultText.textContent = message;
  el.resultMeta.textContent = "";
  el.resultCard.style.background = "#4a1a1a";
  show(el.resultCard);
}

function updateHint(message) {
  el.hintText.textContent = message;
}

function show(elem) {
  elem.classList.remove("hidden");
}

function hide(elem) {
  elem.classList.add("hidden");
}

el.btnLabel.textContent = "Tap to Record";
initCamera();
