const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const ALBUM_URL = process.env.PHOTOS_ALBUM_URL;
if (!ALBUM_URL) {
  console.error("Missing PHOTOS_ALBUM_URL environment variable");
  process.exit(1);
}

const OUT_PATH = path.join(__dirname, "../data/photos.json");

(async () => {
  console.log("Launching browser...");
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    headless: "new",
  });

  const page = await browser.newPage();
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36"
  );

  console.log("Opening album...");
  await page.goto(ALBUM_URL, { waitUntil: "networkidle2", timeout: 60000 });

  // Scroll to bottom repeatedly to force all lazy-loaded photos
  console.log("Scrolling to load all photos...");
  let lastHeight = 0;
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 1500));
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === lastHeight) break;
    lastHeight = newHeight;
  }

  // Extract photo data from Google's internal data payload
  console.log("Extracting photo data...");
  const photos = await page.evaluate(() => {
    const results = [];
    const scripts = Array.from(document.querySelectorAll("script"));

    for (const script of scripts) {
      const text = script.textContent;
      if (!text.includes("AF_initDataCallback")) continue;

      // Match all lh3.googleusercontent.com image URLs
      const urlMatches = text.matchAll(/"(https:\/\/lh3\.googleusercontent\.com\/[^"]+)"/g);
      // Match all timestamps (ms since epoch, 13 digits)
      const tsMatches = text.matchAll(/(\d{13})/g);

      const urls = [...urlMatches].map((m) => m[1]).filter((u) => u.includes("="));
      const timestamps = [...tsMatches].map((m) => parseInt(m[1]));

      urls.forEach((url, i) => {
        const ts = timestamps[i];
        if (!ts) return;
        const date = new Date(ts);
        // Filter to only Stasis dates: May 15–18 2025
        const d = date.getDate();
        const mo = date.getMonth(); // 4 = May
        const yr = date.getFullYear();
        if (yr !== 2025 || mo !== 4 || d < 15 || d > 18) return;

        results.push({
          url: url + "=w1600",
          thumb: url + "=w400",
          timestamp: date.toISOString(),
          day: d,
          hour: date.getHours(),
          minute: date.getMinutes(),
          width: 1600,
          height: 1200,
        });
      });
    }

    return results;
  });

  await browser.close();

  if (photos.length === 0) {
    console.warn("No photos found — Google may have changed their payload format.");
    process.exit(1);
  }

  // Sort chronologically
  photos.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Deduplicate by URL
  const seen = new Set();
  const deduped = photos.filter((p) => {
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(deduped, null, 2));
  console.log(`Done. ${deduped.length} photos written to data/photos.json`);
})();