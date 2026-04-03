const state = {
  connected: false,
  recording: false,
  mediaRecorder: null,
  chunks: [],
  stream: null,
  ringInterval: null,
  ringProgress: 0,
  maxRecordMs: 6000,
};

const el = {
  dot: document.getElementById("connection-dot"),
  connLabel: document.getElementById("connection-label"),
  preview: document.getElementById("preview"),
  recOverlay: document.getElementById("recording-overlay"),
  recordBtn: document.getElementById("record-btn"),
  btnLabel: document.getElementById("btn-label"),
  ringFill: document.getElementById("ring-fill"),
  recordingHint: document.getElementById("recording-hint"),
  outputDock: document.getElementById("output-dock"),
  resultCard: document.getElementById("result-card"),
  resultText: document.getElementById("result-text"),
  againBtn: document.getElementById("again-btn"),
  spinner: document.getElementById("spinner"),
  spinLabel: document.getElementById("spinner-label"),
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
    setIdleUI();
  });

  socket.on("connect_error", (err) => {
    state.connected = false;
    el.dot.className = "disconnected";
    el.connLabel.textContent = `Connection failed: ${err.message}`;
    el.recordBtn.disabled = true;
    el.recordingHint.textContent = "The phone cannot send clips until the socket reconnects.";
  });

  socket.on("disconnect", () => {
    state.connected = false;
    el.dot.className = "disconnected";
    el.connLabel.textContent = "Disconnected - refresh to reconnect";
    el.recordBtn.disabled = true;
    el.recordingHint.textContent = "The phone disconnected from the server. Refresh to reconnect.";
  });

  socket.on("processing", (data) => {
    el.spinLabel.textContent = data.message;
    show(el.spinner);
    revealOutput();
  });

  socket.on("result", (data) => {
    hide(el.spinner);
    el.resultText.textContent = data.sentence;
    el.resultCard.style.background = "#1d3557";
    show(el.resultCard);
    revealOutput();
  });

  socket.on("error", (data) => {
    hide(el.spinner);
    el.resultText.textContent = data.message;
    el.resultCard.style.background = "#4a1a1a";
    show(el.resultCard);
    revealOutput();
  });
}

async function initCamera() {
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    el.preview.srcObject = state.stream;
  } catch (err) {
    el.connLabel.textContent = `Camera unavailable: ${err.message}`;
    el.recordBtn.disabled = true;
    el.recordingHint.textContent = "Camera access is required before recording can start.";
  }
}

el.recordBtn.addEventListener("click", toggleRecording);

function toggleRecording() {
  if (state.recording) {
    stopRecording();
    return;
  }

  startRecording();
}

function startRecording() {
  if (!state.connected || state.recording || !state.stream) {
    return;
  }

  state.recording = true;
  state.chunks = [];

  const mimeType = pickSupportedMimeType();
  if (!mimeType) {
    state.recording = false;
    el.resultText.textContent = "This browser cannot record a supported video format.";
    el.resultCard.style.background = "#4a1a1a";
    show(el.resultCard);
    revealOutput();
    return;
  }

  try {
    state.mediaRecorder = new MediaRecorder(state.stream, {
      mimeType,
      videoBitsPerSecond: 500000,
    });
  } catch (err) {
    state.recording = false;
    el.resultText.textContent = `Recorder failed: ${err.message}`;
    el.resultCard.style.background = "#4a1a1a";
    show(el.resultCard);
    revealOutput();
    return;
  }

  state.mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      state.chunks.push(e.data);
    }
  };

  state.mediaRecorder.onstop = onRecordingStop;
  state.mediaRecorder.start(100);

  show(el.recOverlay);
  el.recordBtn.classList.add("recording");
  el.btnLabel.textContent = "Tap to Stop";
  el.recordingHint.textContent = "Recording now. Tap again when the signing is complete.";
  hide(el.resultCard);
  el.resultCard.style.background = "#1d3557";

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
  setIdleUI();

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
  const normalizedMimeType = normalizeMimeType(mimeType);
  const blob = new Blob(state.chunks, { type: normalizedMimeType });

  if (blob.size < 5000) {
    hide(el.spinner);
    el.resultText.textContent = "Recording too short - tap record and sign for a bit longer.";
    el.resultCard.style.background = "#4a1a1a";
    show(el.resultCard);
    revealOutput();
    return;
  }

  el.spinLabel.textContent = "Sending...";
  el.recordingHint.textContent = "Clip captured. Sending it to the translator now.";
  show(el.spinner);

  blob.arrayBuffer().then((buffer) => {
    socket.emit("video_data", {
      video: buffer,
      mimeType: normalizedMimeType,
    });
  }).catch((err) => {
    hide(el.spinner);
    el.resultText.textContent = `Failed to prepare recording: ${err.message}`;
    el.resultCard.style.background = "#4a1a1a";
    show(el.resultCard);
    revealOutput();
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

function normalizeMimeType(mimeType) {
  if (!mimeType) {
    return "video/webm";
  }

  return mimeType.split(";", 1)[0].trim().toLowerCase() || "video/webm";
}

el.againBtn.addEventListener("click", () => {
  hide(el.resultCard);
  setIdleUI();
});

function setIdleUI() {
  el.btnLabel.textContent = "Tap to Record";
  el.recordingHint.textContent = "Up to 6 seconds. Best results come from steady framing and good light.";
}

function show(elem) {
  elem.classList.remove("hidden");
}

function hide(elem) {
  elem.classList.add("hidden");
}

function revealOutput() {
  el.outputDock.scrollIntoView({ block: "end", behavior: "smooth" });
}

initCamera();
