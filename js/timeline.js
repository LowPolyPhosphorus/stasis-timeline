import { loadPhotos } from "./loader.js";
import { openLightbox } from "./lightbox.js";

// Zoom levels: 0 = days, 1 = hours, 2 = minutes
const ZOOM_LEVELS = ["days", "hours", "minutes"];
const DAY_LABELS = ["Thu May 15", "Fri May 16", "Sat May 17", "Sun May 18"];
const DAY_DATES = [15, 16, 17, 18];

let zoomLevel = 0;
let allPhotos = [];
let offsetX = 0; // horizontal scroll offset in px
let isDragging = false;
let dragStartX = 0;
let dragStartOffset = 0;

const canvas = document.getElementById("timeline-canvas");
const ctx = canvas.getContext("2d");
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const zoomLabel = document.getElementById("zoom-label");

async function init() {
  allPhotos = await loadPhotos();
  resize();
  render();
  bindEvents();
}

function resize() {
  canvas.width = canvas.offsetWidth * devicePixelRatio;
  canvas.height = canvas.offsetHeight * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);
}

function getW() { return canvas.offsetWidth; }
function getH() { return canvas.offsetHeight; }

// --- TIME MATH ---
const START = new Date("2025-05-15T00:00:00");
const END   = new Date("2025-05-18T23:59:59");
const TOTAL_MS = END - START;

function msToX(ms) {
  // maps a ms offset from START to a canvas X, accounting for scroll
  return (ms / TOTAL_MS) * totalWidth() - offsetX;
}

function totalWidth() {
  const base = getW();
  if (zoomLevel === 0) return base;
  if (zoomLevel === 1) return base * 6;   // 6x zoom
  return base * 24;                        // 24x zoom
}

function photoMs(p) {
  return new Date(p.timestamp) - START;
}

// --- RENDER ---
function render() {
  const w = getW();
  const h = getH();
  ctx.clearRect(0, 0, w, h);

  drawBackground(w, h);
  drawAxisLine(w, h);
  drawTicks(w, h);
  drawPhotos(w, h);
}

function drawBackground(w, h) {
  ctx.fillStyle = "#2A2219";
  ctx.fillRect(0, 0, w, h);

  // subtle grid texture feel — horizontal rules
  ctx.strokeStyle = "rgba(196,185,162,0.04)";
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

function drawAxisLine(w, h) {
  const y = h * 0.62;
  ctx.strokeStyle = "#706858";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
}

function drawTicks(w, h) {
  const axisY = h * 0.62;

  if (zoomLevel === 0) {
    // Draw 4 day markers
    DAY_DATES.forEach((day, i) => {
      const ms = (new Date(`2025-05-${String(day).padStart(2,"0")}T12:00:00`) - START);
      const x = msToX(ms);
      if (x < -100 || x > w + 100) return;

      // Tick
      ctx.strokeStyle = "#E86A3A";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, axisY - 12); ctx.lineTo(x, axisY + 12); ctx.stroke();

      // Label
      ctx.fillStyle = "#C4B9A2";
      ctx.font = "13px 'DepartureMono'";
      ctx.textAlign = "center";
      ctx.fillText(DAY_LABELS[i], x, axisY + 30);
    });

  } else if (zoomLevel === 1) {
    // Hourly ticks across all 4 days
    for (let d = 0; d < 4; d++) {
      for (let hr = 0; hr < 24; hr++) {
        const ms = (d * 24 + hr) * 3600 * 1000;
        const x = msToX(ms);
        if (x < -5 || x > w + 5) continue;

        const isMidnight = hr === 0;
        ctx.strokeStyle = isMidnight ? "#E86A3A" : "#706858";
        ctx.lineWidth = isMidnight ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, axisY - (isMidnight ? 14 : 7));
        ctx.lineTo(x, axisY + (isMidnight ? 14 : 7));
        ctx.stroke();

        if (hr % 3 === 0) {
          ctx.fillStyle = "#A89D88";
          ctx.font = "11px 'DepartureMono'";
          ctx.textAlign = "center";
          ctx.fillText(`${String(hr).padStart(2,"0")}:00`, x, axisY + 26);
        }

        if (isMidnight) {
          ctx.fillStyle = "#C4B9A2";
          ctx.font = "12px 'DepartureMono'";
          ctx.fillText(DAY_LABELS[d], x, axisY + 42);
        }
      }
    }

  } else {
    // Minute ticks — every 10 min labeled
    for (let d = 0; d < 4; d++) {
      for (let hr = 0; hr < 24; hr++) {
        for (let min = 0; min < 60; min += 5) {
          const ms = ((d * 24 + hr) * 60 + min) * 60 * 1000;
          const x = msToX(ms);
          if (x < -5 || x > w + 5) continue;

          const isHour = min === 0;
          ctx.strokeStyle = isHour ? "#E86A3A" : "#4D4238";
          ctx.lineWidth = isHour ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(x, axisY - (isHour ? 12 : 5));
          ctx.lineTo(x, axisY + (isHour ? 12 : 5));
          ctx.stroke();

          if (min % 10 === 0) {
            ctx.fillStyle = "#8C826F";
            ctx.font = "9px 'DepartureMono'";
            ctx.textAlign = "center";
            ctx.fillText(`${String(hr).padStart(2,"0")}:${String(min).padStart(2,"0")}`, x, axisY + 22);
          }
        }
      }
    }
  }
}

// Images cache
const imgCache = new Map();
function loadImg(url) {
  if (imgCache.has(url)) return imgCache.get(url);
  const img = new Image();
  img.src = url;
  img.onload = () => render();
  imgCache.set(url, img);
  return img;
}

function drawPhotos(w, h) {
  const axisY = h * 0.62;
  const photoH = zoomLevel === 0 ? 180 : zoomLevel === 1 ? 120 : 80;
  const photoW = photoH * (4 / 3);
  const gap = 4;

  // Bucket photos by visible slot to avoid overlap
  const slots = new Map(); // x-bucket → [photos]
  const bucketSize = photoW + gap;

  let visiblePhotos = allPhotos;

  // At day zoom, pick one representative photo per day
  if (zoomLevel === 0) {
    visiblePhotos = DAY_DATES.map((day) => {
      return allPhotos.find((p) => p.day === day) || null;
    }).filter(Boolean);
  }

  visiblePhotos.forEach((p, globalIdx) => {
    const x = msToX(photoMs(p));
    if (x < -photoW || x > w + photoW) return;

    const bucket = Math.floor(x / bucketSize);
    if (!slots.has(bucket)) slots.set(bucket, []);
    slots.get(bucket).push({ p, x, globalIdx });
  });

  slots.forEach((group) => {
    // Show max photos per bucket depending on zoom
    const maxShow = zoomLevel === 0 ? 1 : zoomLevel === 1 ? 3 : 99;
    const toShow = group.slice(0, maxShow);
    const hidden = group.length - toShow.length;

    toShow.forEach(({ p, x, globalIdx }, stackIdx) => {
      const drawX = x - photoW / 2 + stackIdx * (zoomLevel === 2 ? 0 : 6);
      const drawY = axisY - photoH - 20 - stackIdx * (zoomLevel === 2 ? 0 : 4);

      // Connector line
      ctx.strokeStyle = "#E86A3A";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(x, axisY - 12);
      ctx.lineTo(x, drawY + photoH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Photo or placeholder
      const img = loadImg(p.thumb);
      ctx.save();
      ctx.beginPath();
      ctx.rect(drawX, drawY, photoW, photoH);
      ctx.clip();
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, drawX, drawY, photoW, photoH);
      } else {
        ctx.fillStyle = "#403529";
        ctx.fillRect(drawX, drawY, photoW, photoH);
      }
      ctx.restore();

      // Border
      ctx.strokeStyle = "#706858";
      ctx.lineWidth = 1;
      ctx.strokeRect(drawX, drawY, photoW, photoH);

      // Dot on axis
      ctx.fillStyle = "#E86A3A";
      ctx.beginPath();
      ctx.arc(x, axisY, 4, 0, Math.PI * 2);
      ctx.fill();

      // Store hit area for click detection
      p._hitX = drawX; p._hitY = drawY; p._hitW = photoW; p._hitH = photoH;
      p._globalIdx = globalIdx;
    });

    // "+N more" badge
    if (hidden > 0) {
      const rep = toShow[0];
      const bx = rep.x + photoW / 2 - 24;
      const by = axisY - photoH - 20;
      ctx.fillStyle = "#E86A3A";
      ctx.fillRect(bx, by, 40, 18);
      ctx.fillStyle = "#EBE8E0";
      ctx.font = "bold 10px 'DepartureMono'";
      ctx.textAlign = "center";
      ctx.fillText(`+${hidden}`, bx + 20, by + 13);
    }
  });
}

// --- EVENTS ---
function bindEvents() {
  window.addEventListener("resize", () => { resize(); render(); });

  // Zoom buttons
  zoomInBtn.addEventListener("click", () => {
    if (zoomLevel < 2) { zoomLevel++; clampOffset(); render(); updateZoomUI(); }
  });
  zoomOutBtn.addEventListener("click", () => {
    if (zoomLevel > 0) { zoomLevel--; clampOffset(); render(); updateZoomUI(); }
  });

  // Mouse wheel zoom
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (e.deltaY < 0 && zoomLevel < 2) { zoomLevel++; }
    else if (e.deltaY > 0 && zoomLevel > 0) { zoomLevel--; }
    clampOffset(); render(); updateZoomUI();
  }, { passive: false });

  // Drag to pan
  canvas.addEventListener("mousedown", (e) => {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartOffset = offsetX;
    canvas.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    offsetX = dragStartOffset - (e.clientX - dragStartX);
    clampOffset();
    render();
  });
  window.addEventListener("mouseup", () => {
    isDragging = false;
    canvas.style.cursor = "grab";
  });

  // Touch drag
  canvas.addEventListener("touchstart", (e) => {
    dragStartX = e.touches[0].clientX;
    dragStartOffset = offsetX;
  });
  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    offsetX = dragStartOffset - (e.touches[0].clientX - dragStartX);
    clampOffset();
    render();
  }, { passive: false });

  // Click to open lightbox
  canvas.addEventListener("click", (e) => {
    if (Math.abs(e.clientX - dragStartX) > 5) return; // was a drag
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    for (let i = allPhotos.length - 1; i >= 0; i--) {
      const p = allPhotos[i];
      if (!p._hitX) continue;
      if (cx >= p._hitX && cx <= p._hitX + p._hitW &&
          cy >= p._hitY && cy <= p._hitY + p._hitH) {
        openLightbox(i, allPhotos);
        return;
      }
    }
  });
}

function clampOffset() {
  const maxOffset = Math.max(0, totalWidth() - getW());
  offsetX = Math.max(0, Math.min(offsetX, maxOffset));
}

function updateZoomUI() {
  zoomLabel.textContent = ZOOM_LEVELS[zoomLevel].toUpperCase();
  zoomInBtn.disabled = zoomLevel === 2;
  zoomOutBtn.disabled = zoomLevel === 0;
}

init();