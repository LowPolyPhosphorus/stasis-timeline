// Full-screen photo viewer
let current = 0;
let photos = [];

const overlay = document.getElementById("lightbox");
const img = document.getElementById("lightbox-img");
const caption = document.getElementById("lightbox-caption");

export function openLightbox(index, allPhotos) {
  photos = allPhotos;
  current = index;
  show();
}

function show() {
  const p = photos[current];
  img.src = p.url;
  caption.textContent = formatTime(p.timestamp);
  overlay.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function close() {
  overlay.classList.add("hidden");
  document.body.style.overflow = "";
}

function prev() {
  current = (current - 1 + photos.length) % photos.length;
  show();
}

function next() {
  current = (current + 1) % photos.length;
  show();
}

function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", hour12: true
  });
}

// Wire up controls
document.getElementById("lightbox-close").addEventListener("click", close);
document.getElementById("lightbox-prev").addEventListener("click", prev);
document.getElementById("lightbox-next").addEventListener("click", next);
overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
document.addEventListener("keydown", (e) => {
  if (overlay.classList.contains("hidden")) return;
  if (e.key === "Escape") close();
  if (e.key === "ArrowLeft") prev();
  if (e.key === "ArrowRight") next();
});