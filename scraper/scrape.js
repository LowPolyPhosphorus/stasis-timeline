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

  // Intercept network requests to capture photo URLs and timestamps
  const photoMap = new Map();

  await page.setRequestInterception(true);
  page.on("request", (req) => req.continue());

  page.on("response", async (res) => {
    const url = res.url();
    if (!url.includes("google.com")) return;
    try {
      const ct = res.headers()["content-type"] || "";
      if (!ct.includes("json") && !ct.includes("javascript")) return;
      const text = await res.text();
      // Find all lh3 URLs with timestamps nearby
      const matches = [...text.matchAll(/https:\\\/\\\/lh3\.googleusercontent\.com\\\/([^"\\]+)/g)];
      matches.forEach((m) => {
        const rawUrl = "https://lh3.googleusercontent.com/" + m[1].replace(/\\\//g, "/");
        if (!photoMap.has(rawUrl)) photoMap.set(rawUrl, null);
      });
    } catch {}
  });

  console.log("Opening album...");
  await page.goto(ALBUM_URL, { waitUntil: "networkidle2", timeout: 60000 });

  // Scroll to load all photos
  console.log("Scrolling...");
  let last = 0;
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 1200));
    const h = await page.evaluate(() => document.body.scrollHeight);
    if (h === last) break;
    last = h;
  }

  // Extract from rendered DOM — Google renders img tags with data attributes
  console.log("Extracting from DOM...");
  const domPhotos = await page.evaluate(() => {
    const results = [];
    // Try all img elements with lh3 src
    document.querySelectorAll("img").forEach((img) => {
      const src = img.src || img.getAttribute("src") || "";
      if (!src.includes("lh3.googleusercontent.com")) return;
      // Look for timestamp in closest ancestor's data attributes
      let ts = null;
      let el = img;
      for (let i = 0; i < 8; i++) {
        el = el.parentElement;
        if (!el) break;
        const attrs = el.getAttributeNames();
        for (const a of attrs) {
          const v = el.getAttribute(a);
          if (v && /^\d{13}$/.test(v)) { ts = parseInt(v); break; }
        }
        if (ts) break;
        // also check aria-label for date strings
        const label = el.getAttribute("aria-label") || "";
        const dateMatch = label.match(/(\w+ \d+, \d{4})/);
        if (dateMatch) {
          ts = new Date(dateMatch[1]).getTime();
          break;
        }
      }
      results.push({ src, ts });
    });

    // Also grab from page source data blobs
    const allText = document.documentElement.innerHTML;
    const tsMatches = [...allText.matchAll(/"(\d{13})"/g)].map(m => parseInt(m[1]));
    const urlMatches = [...allText.matchAll(/https:\/\/lh3\.googleusercontent\.com\/[^\s"'<>]+/g)].map(m => m[0]);

    return { domResults: results, tsMatches, urlMatches };
  });

  await browser.close();

  // Build photo list from DOM results first
  const photos = [];
  const seen = new Set();

  // Try DOM imgs with timestamps
  domPhotos.domResults.forEach(({ src, ts }) => {
    if (seen.has(src)) return;
    seen.add(src);
    const baseUrl = src.split("=")[0];
    const date = ts ? new Date(ts) : null;
    if (!date) return;
    const d = date.getDate(), mo = date.getMonth(), yr = date.getFullYear();
    if (yr !== 2025 || mo !== 4 || d < 15 || d > 18) return;
    photos.push({
      url: baseUrl + "=w1600",
      thumb: baseUrl + "=w400",
      timestamp: date.toISOString(),
      day: d, hour: date.getHours(), minute: date.getMinutes(),
    });
  });

  // Fallback: pair URLs with nearby timestamps from page source
  if (photos.length === 0) {
    console.log("DOM method yielded nothing, trying URL+timestamp pairing...");
    const urls = [...new Set(domPhotos.urlMatches)].filter(u => u.includes("lh3.googleusercontent.com"));
    const tsList = domPhotos.tsMatches.filter(ts => {
      const d = new Date(ts);
      return d.getFullYear() === 2025 && d.getMonth() === 4 && d.getDate() >= 15 && d.getDate() <= 18;
    });

    urls.forEach((url, i) => {
      const ts = tsList[i];
      if (!ts) return;
      const date = new Date(ts);
      const baseUrl = url.split("=")[0];
      if (seen.has(baseUrl)) return;
      seen.add(baseUrl);
      photos.push({
        url: baseUrl + "=w1600",
        thumb: baseUrl + "=w400",
        timestamp: date.toISOString(),
        day: date.getDate(), hour: date.getHours(), minute: date.getMinutes(),
      });
    });
  }

  photos.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  if (photos.length === 0) {
    console.error("Still no photos found. Google's structure may need manual inspection.");
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(photos, null, 2));
  console.log(`Done. ${photos.length} photos written to data/photos.json`);
})();