import fs from "node:fs";
import path from "node:path";

const DATA_PATH = path.resolve("data/campaigns.json");
const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const BAD_URLS = new Set([
  "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png",
]);

const BAD_HOST_SUBSTRINGS = [
  "adeevee.com",
  "adforum.com",
  "adsspot.me",
  "es.adforum.com",
  "drive.google.com",
  "storage.googleapis.com/adforum-media",
  "portal-assets.imgix.net",
  "ariandfriends.co",
  "jamieandsanjiv.com",
  "forsman.co",
  "workingnotworking.com",
  "marciojuniot.com",
];

function clean(value) {
  return String(value || "").replace(/&amp;/g, "&").trim();
}

function extractYoutubeId(url) {
  const v = clean(url);
  if (!v) return "";
  let m = v.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (!m) m = v.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (!m) m = v.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/);
  if (!m) m = v.match(/\/vi\/([A-Za-z0-9_-]{11})\//);
  return m ? m[1] : "";
}

function extractVimeoId(url) {
  const v = clean(url);
  if (!v) return "";
  const m = v.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
  return m ? m[1] : "";
}

function normalizeCaseUrl(url) {
  const v = clean(url);
  if (!/^https?:\/\//i.test(v)) return "";
  try {
    const u = new URL(v);
    if (u.protocol === "http:") u.protocol = "https:";
    u.hash = "";
    return u.toString();
  } catch {
    return "";
  }
}

function looksBadThumbnail(url) {
  const t = clean(url);
  if (!t) return true;
  if (BAD_URLS.has(t)) return true;
  // Keep high-quality YouTube variants; only treat default.jpg as low-quality fallback.
  if (/\/default\.jpg$/i.test(t) && /ytimg\.com|youtube\.com/i.test(t)) return true;
  if (t.includes("thumbnail-with-correct-ratio-scaled.jpg")) return true;
  if (t.includes("CLIOS-Vertical-BlackWhite.png")) return true;
  if (t.includes("loadingAnim.gif")) return true;
  if (t.includes("question-invalid.png")) return true;
  let host = "";
  try {
    host = new URL(t).hostname.toLowerCase();
  } catch {
    return true;
  }
  return BAD_HOST_SUBSTRINGS.some((part) => host.includes(part));
}

let checked = 0;
let changed = 0;
let toYoutube = 0;
let toVimeo = 0;
let toScreenshot = 0;

for (const row of data) {
  checked += 1;
  if (!looksBadThumbnail(row.thumbnailUrl)) continue;

  const out = normalizeCaseUrl(row.outboundUrl);
  const src = normalizeCaseUrl(row.sourceUrl);
  const basis = out || src;

  const yid = extractYoutubeId(out) || extractYoutubeId(src);
  if (yid) {
    row.thumbnailUrl = `https://i.ytimg.com/vi/${yid}/hqdefault.jpg`;
    changed += 1;
    toYoutube += 1;
    continue;
  }

  const vid = extractVimeoId(out) || extractVimeoId(src);
  if (vid) {
    row.thumbnailUrl = `https://vumbnail.com/${vid}.jpg`;
    changed += 1;
    toVimeo += 1;
    continue;
  }

  if (basis) {
    row.thumbnailUrl = `https://image.thum.io/get/width/1200/noanimate/${encodeURIComponent(basis)}`;
    changed += 1;
    toScreenshot += 1;
  }
}

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
console.log(
  JSON.stringify(
    { checked, changed, toYoutube, toVimeo, toScreenshot },
    null,
    2
  )
);
