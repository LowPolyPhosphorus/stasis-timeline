import { loadPhotos } from "./loader.js";
import { openLightbox } from "./lightbox.js";

const ZOOM_LEVELS = ["days", "hours", "minutes"];
const DAY_LABELS = ["Thu May 15", "Fri May 16", "Sat May 17", "Sun May 18"];
const DAY_DATES = [15, 16, 17, 18];

let zoomLevel = 0;
let allPhotos = [];
let offsetX = 0;
let isDragging = false;
let dragStartX = 0;
let dragStartOffset = 0;

// Touch pinch zoom
let lastTouchDist = null;
let wheelAccum = 0;
let wheelTimer = null;

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

const START = new Date("2026-05-15T00:00:00");
const END   = new Date("2026-05-18T23:59:59");
const TOTAL_MS = END - START;

function msToX(ms) {
  return (ms / TOTAL_MS) * totalWidth() - offsetX;
}

function totalWidth() {
  const base = getW();
  if (zoomLevel === 0) return base;
  if (zoomLevel === 1) return base * 6;
  return base * 48;
}

function photoMs(p) {
  return new Date(p.timestamp) - START;
}

// axis sits at true vertical center
function axisY() { return getH() * 0.5; }

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
  ctx.fillStyle = "#EBE8E0";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(59,48,38,0.04)";
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
}

function drawAxisLine(w, h) {
  const y = axisY();
  ctx.strokeStyle = "#A89D88";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
}

function drawTicks(w, h) {
  const ay = axisY();

  if (zoomLevel === 0) {
    DAY_DATES.forEach((day, i) => {
      const ms = new Date(`2026-05-${String(day).padStart(2,"0")}T12:00:00`) - START;
      const x = msToX(ms);
      if (x < -100 || x > w + 100) return;

      ctx.strokeStyle = "#E86A3A";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, ay - 12); ctx.lineTo(x, ay + 12); ctx.stroke();

      ctx.fillStyle = "#A89D88";
      ctx.font = "13px 'DepartureMono'";
      ctx.textAlign = "center";
      ctx.fillText(DAY_LABELS[i], x, ay + 28);
    });

  } else if (zoomLevel === 1) {
    for (let d = 0; d < 4; d++) {
      for (let hr = 0; hr < 24; hr++) {
        const ms = (d * 24 + hr) * 3600 * 1000;
        const x = msToX(ms);
        if (x < -5 || x > w + 5) continue;

        const isMidnight = hr === 0;
        ctx.strokeStyle = isMidnight ? "#E86A3A" : "#706858";
        ctx.lineWidth = isMidnight ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(x, ay - (isMidnight ? 14 : 7));
        ctx.lineTo(x, ay + (isMidnight ? 14 : 7));
        ctx.stroke();

        if (hr % 3 === 0) {
          ctx.fillStyle = "#A89D88";
          ctx.font = "11px 'DepartureMono'";
          ctx.textAlign = "center";
          ctx.fillText(`${String(hr).padStart(2,"0")}:00`, x, ay + 24);
        }
        if (isMidnight) {
          ctx.fillStyle = "#C4B9A2";
          ctx.font = "12px 'DepartureMono'";
          ctx.fillText(DAY_LABELS[d], x, ay + 38);
        }
      }
    }

  } else {
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
          ctx.moveTo(x, ay - (isHour ? 12 : 5));
          ctx.lineTo(x, ay + (isHour ? 12 : 5));
          ctx.stroke();

          if (min % 10 === 0) {
            ctx.fillStyle = "#8C826F";
            ctx.font = "9px 'DepartureMono'";
            ctx.textAlign = "center";
            ctx.fillText(`${String(hr).padStart(2,"0")}:${String(min).padStart(2,"0")}`, x, ay + 20);
          }
        }
      }
    }
  }
}

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
  const ay = axisY();

  // Photo sizes — uniform height, variable width to maintain aspect ratio
  const photoH = zoomLevel === 0 ? 160 : zoomLevel === 1 ? 100 : 64;
  const gap = 8;
  const avgPhotoW = photoH * (4 / 3);
  const bucketSize = avgPhotoW + gap;

  const slots = new Map();

  let visiblePhotos = allPhotos;
  if (zoomLevel === 0) {
    visiblePhotos = DAY_DATES.map((day) =>
      allPhotos.find((p) => p.day === day) || null
    ).filter(Boolean);
  }

  visiblePhotos.forEach((p, globalIdx) => {
    const x = msToX(photoMs(p));
    if (x < -avgPhotoW || x > w + avgPhotoW) return;
    const bucket = Math.floor(x / bucketSize);
    if (!slots.has(bucket)) slots.set(bucket, []);
    slots.get(bucket).push({ p, x, globalIdx });
  });

  slots.forEach((group) => {
    // Reduced max per bucket — less cramping
    const maxShow = zoomLevel === 0 ? 1 : zoomLevel === 1 ? 2 : 3;
    const toShow = group.slice(0, maxShow);
    const hidden = group.length - toShow.length;

    toShow.forEach(({ p, x, globalIdx }, stackIdx) => {
      const img = loadImg(p.thumb);

      // Calculate actual width based on image's natural aspect ratio
      let photoW = photoH * (4 / 3);
      if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
        photoW = photoH * (img.naturalWidth / img.naturalHeight);
      }

      const drawX = x - photoW / 2 + stackIdx * 5;
      // Photos hang above axis, centered vertically in upper half
      const drawY = ay - photoH - 24 - stackIdx * 3;

      // Connector line
      ctx.strokeStyle = "#C4B9A2";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(x, ay - 8);
      ctx.lineTo(x, drawY + photoH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Photo
      ctx.save();
      ctx.beginPath();
      ctx.rect(drawX, drawY, photoW, photoH);
      ctx.clip();
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, drawX, drawY, photoW, photoH);
      } else {
        ctx.fillStyle = "#D5CCB7";
        ctx.fillRect(drawX, drawY, photoW, photoH);
        ctx.fillStyle = "#A89D88";
        ctx.font = "10px 'DepartureMono'";
        ctx.textAlign = "center";
        ctx.fillText("loading...", drawX + photoW / 2, drawY + photoH / 2);
      }
      ctx.restore();

      // Border
      ctx.strokeStyle = "#A89D88";
      ctx.lineWidth = 1;
      ctx.strokeRect(drawX, drawY, photoW, photoH);

      // Dot on axis
      ctx.fillStyle = "#E86A3A";
      ctx.beginPath();
      ctx.arc(x, ay, 4, 0, Math.PI * 2);
      ctx.fill();

      p._hitX = drawX; p._hitY = drawY; p._hitW = photoW; p._hitH = photoH;
      p._globalIdx = globalIdx;
    });

    if (hidden > 0) {
      const rep = toShow[0];
      const bx = rep.x - 20;
      const by = ay - 160 - 24;
      ctx.fillStyle = "#E86A3A";
      ctx.fillRect(bx, by, 40, 18);
      ctx.fillStyle = "#EBE8E0";
      ctx.font = "bold 10px 'DepartureMono'";
      ctx.textAlign = "center";
      ctx.fillText(`+${hidden}`, bx + 20, by + 13);
    }
  });
}

function bindEvents() {
  window.addEventListener("resize", () => { resize(); render(); });

  zoomInBtn.addEventListener("click", () => {
    if (zoomLevel < 2) { zoomLevel++; clampOffset(); render(); updateZoomUI(); }
  });
  zoomOutBtn.addEventListener("click", () => {
    if (zoomLevel > 0) { zoomLevel--; clampOffset(); render(); updateZoomUI(); }
  });

  // Mouse wheel — accumulate delta, only zoom after threshold
  // This fixes touchpad sensitivity — touchpads fire many small events
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    wheelAccum += e.deltaY;
    clearTimeout(wheelTimer);
    const threshold = e.deltaMode === 0 ? 120 : 3; // px vs line mode
    if (Math.abs(wheelAccum) >= threshold) {
      if (wheelAccum < 0 && zoomLevel < 2) zoomLevel++;
      else if (wheelAccum > 0 && zoomLevel > 0) zoomLevel--;
      wheelAccum = 0;
      clampOffset(); render(); updateZoomUI();
    }
    // Reset accumulator if user stops scrolling
    wheelTimer = setTimeout(() => { wheelAccum = 0; }, 300);
  }, { passive: false });

  // Mouse drag to pan
  canvas.addEventListener("mousedown", (e) => {
    isDragging = true;
    dragStartX = e.clientX;
    dragStartOffset = offsetX;
    canvas.style.cursor = "grabbing";
  });
  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    offsetX = dragStartOffset - (e.clientX - dragStartX);
    clampOffset(); render();
  });
  window.addEventListener("mouseup", () => {
    isDragging = false;
    canvas.style.cursor = "grab";
  });

  // Touch — single finger pans, two fingers pinch zooms
  canvas.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      dragStartX = e.touches[0].clientX;
      dragStartOffset = offsetX;
      lastTouchDist = null;
    } else if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
    }
  }, { passive: true });

  canvas.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (e.touches.length === 1 && lastTouchDist === null) {
      offsetX = dragStartOffset - (e.touches[0].clientX - dragStartX);
      clampOffset(); render();
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (lastTouchDist !== null) {
        const delta = lastTouchDist - dist;
        // Only zoom after meaningful pinch distance
        if (Math.abs(delta) > 30) {
          if (delta > 0 && zoomLevel > 0) zoomLevel--;
          else if (delta < 0 && zoomLevel < 2) zoomLevel++;
          lastTouchDist = dist;
          clampOffset(); render(); updateZoomUI();
        }
      }
    }
  }, { passive: false });

  canvas.addEventListener("touchend", () => {
    lastTouchDist = null;
  });

  // Click lightbox
  canvas.addEventListener("click", (e) => {
    if (Math.abs(e.clientX - dragStartX) > 5) return;
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