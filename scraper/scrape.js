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
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1920,1080"],
    headless: "new",
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
  );

  console.log("Opening album...");
  await page.goto(ALBUM_URL, { waitUntil: "networkidle2", timeout: 60000 });

  // Scroll to load all photos
  console.log("Scrolling...");
  let last = 0;
  for (let i = 0; i < 60; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 2000));
    const h = await page.evaluate(() => document.body.scrollHeight);
    if (h === last) break;
    last = h;
  }

  console.log("Extracting...");
  const results = await page.evaluate(() => {
    const photos = [];
    const seen = new Set();

    // Pull all img srcs from the page
    document.querySelectorAll("img[src*='lh3.googleusercontent.com']").forEach((img) => {
      const src = img.src;
      const base = src.split("=")[0];
      if (seen.has(base)) return;
      seen.add(base);

      // Walk up DOM tree looking for a data-date, aria-label, or title with a date
      let dateStr = null;
      let el = img;
      for (let i = 0; i < 10; i++) {
        el = el.parentElement;
        if (!el) break;
        // Check aria-label like "Photo - May 16, 2025"
        const label = el.getAttribute("aria-label") || "";
        const titleAttr = el.getAttribute("title") || "";
        const text = label + " " + titleAttr;
        const m = text.match(/([A-Z][a-z]+ \d{1,2},? \d{4})/);
        if (m) { dateStr = m[1]; break; }
      }

      photos.push({ base, dateStr });
    });

    // Also grab all text content looking for timestamps
    const html = document.documentElement.innerHTML;

    // Google embeds photo metadata as JSON arrays in script tags
    // Pattern: ["URL",...,TIMESTAMP_MS,...]
    const photoDataPattern = /\["(https:\\\/\\\/lh3\.googleusercontent\.com\\\/[^"]+)"[^\]]*?(\d{13})/g;
    let m;
    while ((m = photoDataPattern.exec(html)) !== null) {
      const base = m[1].replace(/\\\//g, "/").split("=")[0];
      const ts = parseInt(m[2]);
      if (!seen.has(base)) {
        seen.add(base);
        photos.push({ base, ts });
      }
    }

    return photos;
  });

  const pageInfo = await page.evaluate(() => {
    const imgs = document.querySelectorAll("img").length;
    const lh3imgs = document.querySelectorAll("img[src*='lh3']").length;
    const bodyLen = document.body.innerHTML.length;
    const sample = document.body.innerHTML.slice(0, 2000);
    return { imgs, lh3imgs, bodyLen, sample };
  });
  console.log("Page info:", JSON.stringify(pageInfo, null, 2));

  await browser.close();

  const photos = [];
  results.forEach(({ base, dateStr, ts }) => {
    let date = null;
    if (ts) {
      date = new Date(ts);
    } else if (dateStr) {
      date = new Date(dateStr);
    }

    if (!date || isNaN(date.getTime())) return;

    // no filter — dump everything for inspection
    photos.push({
      url: base + "=w1600",
      thumb: base + "=w400",
      timestamp: date.toISOString(),
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
    });
  });

  photos.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(photos.slice(0, 5), null, 2));
  console.log(`Found ${photos.length} total photos.`);
  console.log(`Wrote first 5 to photos.json for inspection.`);
})();