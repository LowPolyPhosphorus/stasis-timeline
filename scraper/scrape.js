const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");

const ALBUM_URL = process.env.PHOTOS_ALBUM_URL;
if (!ALBUM_URL) {
  console.error("Missing PHOTOS_ALBUM_URL");
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
  await page.setViewport({ width: 1920, height: 1080 });
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
  );

  // Intercept the internal Google Photos API calls
  const photoData = [];

  page.on("response", async (res) => {
    const url = res.url();
    const ct = res.headers()["content-type"] || "";
    if (!ct.includes("json") && !url.includes("batchexecute") && !url.includes("photos.google")) return;
    try {
      const text = await res.text();
      if (!text.includes("lh3.googleusercontent.com")) return;
      // Save all responses that contain photo URLs for inspection
      const matches = [...text.matchAll(/https:\/\/lh3\.googleusercontent\.com\/[^"'\s\\]+/g)];
      if (matches.length > 2) {
        photoData.push({ url, count: matches.length, sample: text.slice(0, 500) });
        console.log(`Captured response from ${url.slice(0, 80)} with ${matches.length} lh3 URLs`);
      }
    } catch {}
  });

  console.log("Opening album...");
  await page.goto(ALBUM_URL, { waitUntil: "networkidle2", timeout: 60000 });

  // Wait extra time for JS to execute
  await new Promise((r) => setTimeout(r, 5000));

  // Scroll
  console.log("Scrolling...");
  let last = 0;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await new Promise((r) => setTimeout(r, 2000));
    const h = await page.evaluate(() => document.body.scrollHeight);
    if (h === last) break;
    last = h;
  }

  await new Promise((r) => setTimeout(r, 3000));

  console.log(`Captured ${photoData.length} relevant network responses`);
  
  // Write captured data for inspection
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(
    OUT_PATH.replace("photos.json", "network-log.json"),
    JSON.stringify(photoData, null, 2)
  );

  await browser.close();

  // Write empty photos for now
  fs.writeFileSync(OUT_PATH, JSON.stringify([], null, 2));
  console.log("Done. Check data/network-log.json for captured API responses.");
})();