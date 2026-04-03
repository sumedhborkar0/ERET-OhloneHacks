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

  socket.on("processing", (data) => {
    el.spinLabel.textContent = data.message;
    show(el.spinner);
  });

  socket.on("result", (data) => {
    hide(el.spinner);
    el.resultText.textContent = data.sentence;
    el.resultCard.style.background = "#1d3557";
    show(el.resultCard);
  });

  socket.on("error", (data) => {
    hide(el.spinner);
    el.resultText.textContent = data.message;
    el.resultCard.style.background = "#4a1a1a";
    show(el.resultCard);
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
  }
}

el.recordBtn.addEventListener("pointerdown", startRecording);
el.recordBtn.addEventListener("pointerup", stopRecording);
el.recordBtn.addEventListener("pointerleave", stopRecording);

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
  el.btnLabel.textContent = "Release to Send";
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
  el.btnLabel.textContent = "Hold to Sign";

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

  if (blob.size < 5000) {
    hide(el.spinner);
    el.resultText.textContent = "Recording too short - hold the button while signing.";
    el.resultCard.style.background = "#4a1a1a";
    show(el.resultCard);
    return;
  }

  el.spinLabel.textContent = "Sending...";
  show(el.spinner);

  blob.arrayBuffer().then((buffer) => {
    socket.emit("video_data", {
      video: buffer,
      mimeType: mimeType,
    });
  }).catch((err) => {
    hide(el.spinner);
    el.resultText.textContent = `Failed to prepare recording: ${err.message}`;
    el.resultCard.style.background = "#4a1a1a";
    show(el.resultCard);
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
});

function show(elem) {
  elem.classList.remove("hidden");
}

function hide(elem) {
  elem.classList.add("hidden");
}

initCamera();
