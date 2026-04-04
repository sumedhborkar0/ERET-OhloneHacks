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
  hands: null,
  faceMesh: null,
  trackingBusy: false,
  trackingLoopId: 0,
  lastTrackingRunAt: 0,
  trackingAvailable: false,
  trackingStarted: false,
  frameCounter: 0,
  latestHandsResults: null,
  latestFaceLandmarks: null,
  lastHandsResultAt: 0,
  lastFaceResultAt: 0,
  faceTrackingMode: "off",
  faceFailureCount: 0,
  recordingStartedAt: 0,
  lastTrackingSampleAt: 0,
  trackingSamples: [],
  processingCanvas: document.createElement("canvas"),
  faceProcessingCanvas: document.createElement("canvas"),
  processingCtx: null,
  faceProcessingCtx: null,
};

const TRACKING_SAMPLE_INTERVAL_MS = 200;

const el = {
  dot: document.getElementById("connection-dot"),
  connLabel: document.getElementById("connection-label"),
  preview: document.getElementById("preview"),
  overlay: document.getElementById("tracking-overlay"),
  trackingStatus: document.getElementById("tracking-status"),
  faceStatus: document.getElementById("face-status"),
  handsStatus: document.getElementById("hands-status"),
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

const overlayCtx = el.overlay.getContext("2d");
let socket = null;
state.processingCtx = state.processingCanvas.getContext("2d", { alpha: false, desynchronized: true })
  || state.processingCanvas.getContext("2d");
state.faceProcessingCtx = state.faceProcessingCanvas.getContext("2d", { alpha: false, desynchronized: true })
  || state.faceProcessingCanvas.getContext("2d");

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

function setTrackingHud(status, face, hands) {
  el.trackingStatus.textContent = status;
  el.faceStatus.textContent = face;
  el.handsStatus.textContent = hands;
}

function resizeOverlayCanvas(width, height) {
  if (!width || !height) {
    return;
  }

  if (el.overlay.width !== width || el.overlay.height !== height) {
    el.overlay.width = width;
    el.overlay.height = height;
  }
}

function strokeCorners(ctx, width, height, color) {
  const inset = 18;
  const segment = 22;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.moveTo(inset, inset + segment);
  ctx.lineTo(inset, inset);
  ctx.lineTo(inset + segment, inset);
  ctx.moveTo(width - inset - segment, inset);
  ctx.lineTo(width - inset, inset);
  ctx.lineTo(width - inset, inset + segment);
  ctx.moveTo(inset, height - inset - segment);
  ctx.lineTo(inset, height - inset);
  ctx.lineTo(inset + segment, height - inset);
  ctx.moveTo(width - inset - segment, height - inset);
  ctx.lineTo(width - inset, height - inset);
  ctx.lineTo(width - inset, height - inset - segment);
  ctx.stroke();
  ctx.restore();
}

function drawGlow(drawFn, glowColor, blur) {
  overlayCtx.save();
  overlayCtx.shadowColor = glowColor;
  overlayCtx.shadowBlur = blur;
  drawFn();
  overlayCtx.restore();
}

function getProcessingSize() {
  const sourceWidth = el.preview.videoWidth || 640;
  const sourceHeight = el.preview.videoHeight || 480;
  const maxDimension = state.recording ? 256 : 320;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));

  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function shouldRunFaceMesh() {
  if (!state.faceMesh) {
    return false;
  }

  const interval = state.recording ? 5 : 3;
  return state.frameCounter % interval === 0 || !state.latestFaceLandmarks;
}

function drawFaceOverlay(landmarks) {
  if (!Array.isArray(landmarks) || !window.FACEMESH_CONTOURS) {
    return;
  }

  drawGlow(() => {
    window.drawConnectors(overlayCtx, landmarks, window.FACEMESH_CONTOURS, {
      color: "rgba(121, 200, 255, 0.24)",
      lineWidth: 4,
    });
  }, "rgba(121, 200, 255, 0.28)", 14);

  window.drawConnectors(overlayCtx, landmarks, window.FACEMESH_CONTOURS, {
    color: "rgba(148, 212, 255, 0.82)",
    lineWidth: 1.2,
  });
}

function roundCoord(value) {
  return Math.round(value * 1000) / 1000;
}

function summarizeFaceLandmarks(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length === 0) {
    return null;
  }

  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;

  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return {
    center: [roundCoord((minX + maxX) / 2), roundCoord((minY + maxY) / 2)],
    size: [roundCoord(maxX - minX), roundCoord(maxY - minY)],
    mouth: landmarks[13] && landmarks[14]
      ? [
        roundCoord((landmarks[13].x + landmarks[14].x) / 2),
        roundCoord((landmarks[13].y + landmarks[14].y) / 2),
      ]
      : null,
  };
}

function normalizeHandLabel(label, landmarks) {
  if (label === "Left" || label === "Right") {
    return label;
  }

  const wrist = Array.isArray(landmarks) ? landmarks[0] : null;
  if (!wrist) {
    return null;
  }

  return wrist.x < 0.5 ? "Left" : "Right";
}

function getTrackedHands() {
  if (performance.now() - state.lastHandsResultAt >= 500) {
    return [];
  }

  const landmarksList = state.latestHandsResults?.multiHandLandmarks || [];
  const handednessList = state.latestHandsResults?.multiHandedness || [];
  const trackedHands = [];

  landmarksList.forEach((landmarks, index) => {
    const handedness = handednessList[index]?.[0]?.label || handednessList[index]?.label || null;
    trackedHands.push({
      landmarks,
      label: normalizeHandLabel(handedness, landmarks),
    });
  });

  trackedHands.sort((a, b) => {
    if (a.label && b.label && a.label !== b.label) {
      return a.label.localeCompare(b.label);
    }

    const ax = a.landmarks?.[0]?.x ?? 0;
    const bx = b.landmarks?.[0]?.x ?? 0;
    return ax - bx;
  });

  return trackedHands;
}

function summarizeHandLandmarks(trackedHands) {
  return trackedHands.map(({ label, landmarks }) => ({
    label: label || "Unknown",
    wrist: landmarks[0]
      ? [roundCoord(landmarks[0].x), roundCoord(landmarks[0].y)]
      : null,
    palm: landmarks[9]
      ? [roundCoord(landmarks[9].x), roundCoord(landmarks[9].y)]
      : null,
    indexTip: landmarks[8]
      ? [roundCoord(landmarks[8].x), roundCoord(landmarks[8].y)]
      : null,
  }));
}

function recordTrackingSample(trackedHands, faceTracked) {
  if (!state.recording || !state.recordingStartedAt) {
    return;
  }

  const now = performance.now();
  const elapsedMs = Math.max(0, Math.round(now - state.recordingStartedAt));
  if (elapsedMs - state.lastTrackingSampleAt < TRACKING_SAMPLE_INTERVAL_MS) {
    return;
  }

  state.lastTrackingSampleAt = elapsedMs;

  state.trackingSamples.push({
    tMs: elapsedMs,
    face: faceTracked ? summarizeFaceLandmarks(state.latestFaceLandmarks) : null,
    hands: summarizeHandLandmarks(trackedHands),
  });
}

function drawTrackingOverlay(width, height) {
  resizeOverlayCanvas(width, height);
  overlayCtx.clearRect(0, 0, width, height);
  overlayCtx.save();

  if (state.facingMode === "user") {
    overlayCtx.translate(width, 0);
    overlayCtx.scale(-1, 1);
  }

  const now = performance.now();
  const faceTracked = now - state.lastFaceResultAt < 550
    && Array.isArray(state.latestFaceLandmarks)
    && state.latestFaceLandmarks.length > 0;
  const trackedHands = getTrackedHands();
  const handsTracked = trackedHands.length;
  const lockStrength = faceTracked || handsTracked > 0;

  recordTrackingSample(trackedHands, faceTracked);

  strokeCorners(
    overlayCtx,
    width,
    height,
    lockStrength ? "rgba(126, 255, 218, 0.88)" : "rgba(255, 193, 133, 0.7)",
  );

  if (faceTracked) {
    drawFaceOverlay(state.latestFaceLandmarks);
  }

  if (typeof window.drawConnectors === "function" && typeof window.drawLandmarks === "function" && window.HAND_CONNECTIONS) {
    trackedHands.forEach(({ landmarks }) => {
      const glowColor = "rgba(104, 255, 219, 0.38)";
      const fillColor = "rgba(43, 215, 170, 0.88)";
      const lineColor = "rgba(196, 255, 241, 0.96)";
      const glowStroke = "rgba(104, 255, 219, 0.32)";

      drawGlow(() => {
        window.drawConnectors(overlayCtx, landmarks, window.HAND_CONNECTIONS, {
          color: glowStroke,
          lineWidth: 8,
        });
      }, glowColor, 18);

      window.drawConnectors(overlayCtx, landmarks, window.HAND_CONNECTIONS, {
        color: lineColor,
        lineWidth: 2,
      });
      window.drawLandmarks(overlayCtx, landmarks, {
        color: "rgba(255, 247, 243, 0.95)",
        fillColor,
        lineWidth: 1,
        radius: 3,
      });
    });
  }

  if (!state.trackingAvailable) {
    setTrackingHud("Overlay unavailable", "Unavailable", "Unavailable");
  } else if (handsTracked === 2 && faceTracked) {
    setTrackingHud("Full lock", "Locked", "Both visible");
  } else if (handsTracked > 0 || faceTracked) {
    const faceLabel = state.faceTrackingMode === "mesh" ? (faceTracked ? "Locked" : "Searching") : "Unavailable";
    setTrackingHud("Tracking live", faceLabel, handsTracked === 0 ? "Searching" : `${handsTracked}/2 visible`);
  } else {
    const faceLabel = state.faceTrackingMode === "mesh" ? "Waiting" : "Unavailable";
    setTrackingHud("Searching frame", faceLabel, "Waiting");
  }

  overlayCtx.restore();
}

function startTrackingLoop() {
  if (!state.hands || state.trackingLoopId || state.trackingStarted) {
    return;
  }

  state.trackingStarted = true;
  queueTrackingFrame();
}

function stopTrackingLoop() {
  if (state.trackingLoopId) {
    window.cancelAnimationFrame(state.trackingLoopId);
    state.trackingLoopId = 0;
  }
  state.trackingStarted = false;
}

function queueTrackingFrame() {
  if (!state.hands || !state.stream) {
    return;
  }

  state.trackingLoopId = window.requestAnimationFrame(() => handleTrackingFrame(performance.now()));
}

async function detectFaceMesh() {
  if (!state.faceMesh || !state.faceProcessingCtx) {
    state.latestFaceLandmarks = null;
    return false;
  }

  const sourceWidth = el.preview.videoWidth || 640;
  const sourceHeight = el.preview.videoHeight || 480;
  const maxDimension = 144;
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  if (state.faceProcessingCanvas.width !== width || state.faceProcessingCanvas.height !== height) {
    state.faceProcessingCanvas.width = width;
    state.faceProcessingCanvas.height = height;
  }

  state.faceProcessingCtx.drawImage(el.preview, 0, 0, width, height);

  try {
    await state.faceMesh.send({ image: state.faceProcessingCanvas });
    state.faceFailureCount = 0;
    return true;
  } catch (_err) {
    state.faceFailureCount += 1;
    if (state.faceFailureCount >= 3) {
      state.faceTrackingMode = "off";
      state.faceMesh = null;
      state.latestFaceLandmarks = null;
    }
    return false;
  }
}

async function handleTrackingFrame(now) {
  state.trackingLoopId = 0;

  if (!state.stream || state.trackingBusy || el.preview.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    queueTrackingFrame();
    return;
  }

  const minFrameGapMs = state.recording ? 90 : 70;
  if (now - state.lastTrackingRunAt < minFrameGapMs) {
    queueTrackingFrame();
    return;
  }

  const { width, height } = getProcessingSize();
  if (!state.processingCtx) {
    queueTrackingFrame();
    return;
  }

  state.lastTrackingRunAt = now;
  state.frameCounter += 1;

  if (state.processingCanvas.width !== width || state.processingCanvas.height !== height) {
    state.processingCanvas.width = width;
    state.processingCanvas.height = height;
  }

  state.processingCtx.drawImage(el.preview, 0, 0, width, height);
  state.trackingBusy = true;

  let handsOk = false;

  try {
    await state.hands.send({ image: state.processingCanvas });
    handsOk = true;
  } catch (_err) {
    setTrackingHud("Overlay paused", state.faceTrackingMode === "mesh" ? "Waiting" : "Unavailable", "Paused");
  }

  if (handsOk && shouldRunFaceMesh()) {
    await detectFaceMesh();
  }

  if (handsOk) {
    drawTrackingOverlay(width, height);
  }

  state.trackingBusy = false;
  queueTrackingFrame();
}

function initTrackers() {
  if (
    typeof window.Hands !== "function" ||
    typeof window.FaceMesh !== "function" ||
    typeof window.drawConnectors !== "function" ||
    typeof window.drawLandmarks !== "function"
  ) {
    setTrackingHud("Overlay unavailable", "Missing", "Missing");
    return;
  }

  state.hands = new window.Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
  });
  state.hands.setOptions({
    maxNumHands: 2,
    modelComplexity: 0,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.45,
  });
  state.hands.onResults((results) => {
    state.latestHandsResults = results;
    state.lastHandsResultAt = performance.now();
  });

  try {
    state.faceMesh = new window.FaceMesh({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    state.faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: false,
      minDetectionConfidence: 0.45,
      minTrackingConfidence: 0.4,
    });
    state.faceMesh.onResults((results) => {
      state.latestFaceLandmarks = results.multiFaceLandmarks?.[0] || state.latestFaceLandmarks;
      state.lastFaceResultAt = performance.now();
    });
    state.faceTrackingMode = "mesh";
  } catch (_err) {
    state.faceMesh = null;
    state.faceTrackingMode = "off";
  }

  state.trackingAvailable = true;
  const faceLabel = state.faceTrackingMode === "mesh" ? "Waiting" : "Unavailable";
  setTrackingHud("Overlay ready", faceLabel, "Waiting");
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
    state.lastTrackingRunAt = 0;
    state.frameCounter = 0;
    state.latestHandsResults = null;
    state.latestFaceLandmarks = null;
    state.lastHandsResultAt = 0;
    state.lastFaceResultAt = 0;
    state.recordingStartedAt = 0;
    state.lastTrackingSampleAt = 0;
    state.trackingSamples = [];
    applyFacingModeUI();
    el.toggleCameraBtn.disabled = false;
    await el.preview.play().catch(() => {});
    startTrackingLoop();
  } catch (err) {
    el.connLabel.textContent = `Camera unavailable: ${err.message}`;
    el.recordBtn.disabled = true;
    el.toggleCameraBtn.disabled = true;
    el.recordingHint.textContent = "Camera access is required before recording can start.";
    setTrackingHud("Camera blocked", "Unavailable", "Unavailable");
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
  state.lastTrackingRunAt = 0;
  state.frameCounter = 0;
  state.recordingStartedAt = performance.now();
  state.lastTrackingSampleAt = -TRACKING_SAMPLE_INTERVAL_MS;
  state.trackingSamples = [];

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
  state.lastTrackingRunAt = 0;
  state.frameCounter = 0;
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
      tracking: state.trackingSamples,
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
  el.preview.classList.toggle("is-mirrored", state.facingMode === "user");
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
  stopTrackingLoop();
  if (!state.stream) {
    return;
  }

  for (const track of state.stream.getTracks()) {
    track.stop();
  }

  state.stream = null;
}

window.addEventListener("beforeunload", releaseStream);
el.preview.addEventListener("loadedmetadata", startTrackingLoop);
el.preview.addEventListener("playing", startTrackingLoop);

initTrackers();
initCamera();
