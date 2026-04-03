const state = {
  connected: false,
  recording: false,
  mediaRecorder: null,
  chunks: [],
  stream: null,
  facingMode: "user",
  ringInterval: null,
  ringProgress: 0,
  maxRecordMs: 6000,
  holistic: null,
  holisticReady: false,
  holisticBusy: false,
  latestHolistic: null,
  landmarkFrames: [],
  holisticFrameCounter: 0,
  holisticLoopId: null,
};

const el = {
  dot: document.getElementById("connection-dot"),
  connLabel: document.getElementById("connection-label"),
  preview: document.getElementById("preview"),
  overlayCanvas: document.getElementById("overlay-canvas"),
  cameraContainer: document.getElementById("camera-container"),
  recOverlay: document.getElementById("recording-overlay"),
  focusCameraBtn: document.getElementById("focus-camera-btn"),
  toggleCameraBtn: document.getElementById("toggle-camera-btn"),
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
const overlayCtx = el.overlayCanvas ? el.overlayCanvas.getContext("2d") : null;
const POSE_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24];
const FACE_INDICES = [13, 14, 61, 291, 33, 263, 70, 300];

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
  releaseStream();

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: state.facingMode },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
      audio: false,
    });
    el.preview.srcObject = state.stream;
    await el.preview.play();
    syncOverlaySize();
    applyFacingModeUI();
    el.toggleCameraBtn.disabled = false;
    startHolisticLoop();
  } catch (err) {
    el.connLabel.textContent = `Camera unavailable: ${err.message}`;
    el.recordBtn.disabled = true;
    el.toggleCameraBtn.disabled = true;
    el.recordingHint.textContent = "Camera access is required before recording can start.";
  }
}

el.recordBtn.addEventListener("click", toggleRecording);
el.focusCameraBtn.addEventListener("click", toggleFocusMode);
el.toggleCameraBtn.addEventListener("click", toggleCamera);
el.cameraContainer.addEventListener("click", handleCameraContainerClick);

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
  state.landmarkFrames = [];
  state.holisticFrameCounter = 0;

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
      landmarks: state.landmarkFrames,
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

async function toggleCamera() {
  if (state.recording) {
    el.recordingHint.textContent = "Stop recording before switching cameras.";
    return;
  }

  state.facingMode = state.facingMode === "user" ? "environment" : "user";
  el.toggleCameraBtn.disabled = true;
  await initCamera();
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

function applyFacingModeUI() {
  const mirrored = state.facingMode === "user";
  el.preview.classList.toggle("is-mirrored", mirrored);
  if (el.overlayCanvas) {
    el.overlayCanvas.classList.toggle("is-mirrored", mirrored);
  }
}

function handleCameraContainerClick(event) {
  if (event.target.closest("button")) {
    return;
  }

  if (!document.body.classList.contains("camera-focus")) {
    setFocusMode(true);
  }
}

function toggleFocusMode(event) {
  event.stopPropagation();
  setFocusMode(!document.body.classList.contains("camera-focus"));
}

function setFocusMode(enabled) {
  document.body.classList.toggle("camera-focus", enabled);
  el.focusCameraBtn.textContent = enabled ? "Close Fullscreen" : "Fullscreen";
}

function releaseStream() {
  stopHolisticLoop();
  clearOverlay();

  if (!state.stream) {
    return;
  }

  for (const track of state.stream.getTracks()) {
    track.stop();
  }

  state.stream = null;
}

async function initHolistic() {
  if (typeof window.Holistic !== "function") {
    el.recordingHint.textContent = "MediaPipe Holistic could not load. Using video-only translation.";
    return;
  }

  const holistic = new window.Holistic({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`,
  });

  holistic.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
    refineFaceLandmarks: false,
  });

  holistic.onResults((results) => {
    state.latestHolistic = {
      leftHandLandmarks: results.leftHandLandmarks || null,
      rightHandLandmarks: results.rightHandLandmarks || null,
      poseLandmarks: results.poseLandmarks || null,
      faceLandmarks: results.faceLandmarks || null,
    };
    drawHolisticOverlay(results);
  });

  state.holistic = holistic;
  state.holisticReady = true;
  if (state.stream) {
    startHolisticLoop();
  }
}

function startHolisticLoop() {
  if (!state.holisticReady || !state.holistic || !state.stream || state.holisticLoopId) {
    return;
  }

  const run = async () => {
    if (!state.stream) {
      state.holisticLoopId = null;
      return;
    }

    state.holisticLoopId = requestAnimationFrame(run);
    state.holisticFrameCounter += 1;

    if (state.holisticBusy || state.holisticFrameCounter % 2 !== 0) {
      return;
    }

    state.holisticBusy = true;
    try {
      syncOverlaySize();
      await state.holistic.send({ image: el.preview });

      if (state.recording && state.holisticFrameCounter % 3 === 0) {
        const packed = packHolisticFrame(state.latestHolistic);
        if (packed) {
          state.landmarkFrames.push(packed);
        }
      }
    } catch (_) {
      // Keep camera flow alive even if Holistic drops a frame.
    } finally {
      state.holisticBusy = false;
    }
  };

  state.holisticLoopId = requestAnimationFrame(run);
}

function stopHolisticLoop() {
  if (state.holisticLoopId) {
    cancelAnimationFrame(state.holisticLoopId);
    state.holisticLoopId = null;
  }
  state.holisticBusy = false;
}

function syncOverlaySize() {
  if (!el.overlayCanvas) {
    return;
  }

  const width = el.preview.videoWidth || 640;
  const height = el.preview.videoHeight || 480;
  if (el.overlayCanvas.width !== width || el.overlayCanvas.height !== height) {
    el.overlayCanvas.width = width;
    el.overlayCanvas.height = height;
  }
}

function clearOverlay() {
  if (!overlayCtx || !el.overlayCanvas) {
    return;
  }
  overlayCtx.clearRect(0, 0, el.overlayCanvas.width, el.overlayCanvas.height);
}

function drawHolisticOverlay(results) {
  if (!overlayCtx || !el.overlayCanvas || typeof window.drawConnectors !== "function" || typeof window.drawLandmarks !== "function") {
    return;
  }

  clearOverlay();

  const pose = results.poseLandmarks || [];
  const left = results.leftHandLandmarks || [];
  const right = results.rightHandLandmarks || [];
  const face = results.faceLandmarks || [];

  if (pose.length && window.POSE_CONNECTIONS) {
    window.drawConnectors(overlayCtx, pose, window.POSE_CONNECTIONS, {
      color: "#8bd2ff",
      lineWidth: 2,
    });
    window.drawLandmarks(overlayCtx, pose, {
      color: "#bce8ff",
      radius: 2,
    });
  }

  if (left.length && window.HAND_CONNECTIONS) {
    window.drawConnectors(overlayCtx, left, window.HAND_CONNECTIONS, {
      color: "#66ef9a",
      lineWidth: 3,
    });
    window.drawLandmarks(overlayCtx, left, {
      color: "#a6ffc4",
      radius: 3,
    });
  }

  if (right.length && window.HAND_CONNECTIONS) {
    window.drawConnectors(overlayCtx, right, window.HAND_CONNECTIONS, {
      color: "#ffb26a",
      lineWidth: 3,
    });
    window.drawLandmarks(overlayCtx, right, {
      color: "#ffd5a8",
      radius: 3,
    });
  }

  if (face.length) {
    window.drawLandmarks(overlayCtx, face, {
      color: "#f6d7ff",
      radius: 1,
    });
  }
}

function pickLandmarks(landmarks, indices) {
  if (!Array.isArray(landmarks)) {
    return null;
  }

  return indices.map((index) => {
    const point = landmarks[index];
    if (!point) {
      return null;
    }
    return {
      x: point.x,
      y: point.y,
      z: point.z,
      visibility: point.visibility,
    };
  });
}

function mapPoints(landmarks) {
  if (!Array.isArray(landmarks)) {
    return null;
  }

  return landmarks.map((point) => ({
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: point.visibility,
  }));
}

function packHolisticFrame(frame) {
  if (!frame) {
    return null;
  }

  const left = mapPoints(frame.leftHandLandmarks);
  const right = mapPoints(frame.rightHandLandmarks);
  const pose = pickLandmarks(frame.poseLandmarks, POSE_INDICES);
  const face = pickLandmarks(frame.faceLandmarks, FACE_INDICES);

  if (!left && !right && !pose && !face) {
    return null;
  }

  return {
    t: Date.now(),
    left,
    right,
    pose,
    face,
  };
}

Promise.allSettled([initCamera(), initHolistic()]);
