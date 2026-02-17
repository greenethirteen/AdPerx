import fs from "node:fs";
import path from "node:path";

const DATA_PATH = path.resolve("data/campaigns.json");
const QUEUE_PATH = path.resolve("data/thumbnail_fix_queue.json");
const REPORT_PATH = path.resolve("data/repair_thumbnail_queue.report.json");

function clean(raw) {
  return String(raw || "").replace(/&amp;/g, "&").trim();
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function extractYoutubeId(raw) {
  const s = clean(raw);
  if (!s) return "";
  let m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (!m) m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (!m) m = s.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/);
  if (!m) m = s.match(/\/embed\/([A-Za-z0-9_-]{11})/);
  if (!m) m = s.match(/\/vi\/([A-Za-z0-9_-]{11})\//);
  return m ? m[1] : "";
}

function decodeThumioTarget(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("image.thum.io")) return "";
    const marker = "/noanimate/";
    const idx = u.pathname.indexOf(marker);
    if (idx < 0) return "";
    let target = u.pathname.slice(idx + marker.length);
    for (let i = 0; i < 3; i += 1) {
      try {
        target = decodeURIComponent(target);
      } catch {
        break;
      }
    }
    return /^https?:\/\//i.test(target) ? target : "";
  } catch {
    return "";
  }
}

function thumio(url) {
  const u = clean(url);
  if (!u || !/^https?:\/\//i.test(u)) return "";
  return `https://image.thum.io/get/width/1200/noanimate/${u}`;
}

if (!fs.existsSync(DATA_PATH) || !fs.existsSync(QUEUE_PATH)) {
  console.error("Missing campaigns or thumbnail fix queue");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const queueBlob = JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
const queue = Array.isArray(queueBlob) ? queueBlob : queueBlob.rows || [];
const byId = new Map(data.map((r) => [r.id, r]));

let processed = 0;
let changed = 0;
let ytFallback = 0;
let thumioFixed = 0;
let screenshotFallback = 0;
let missing = 0;
const updates = [];

for (const item of queue) {
  const rec = byId.get(item.id);
  processed += 1;
  if (!rec) {
    missing += 1;
    continue;
  }

  const oldThumb = clean(rec.thumbnailUrl);
  const out = clean(rec.outboundUrl);
  const src = clean(rec.sourceUrl);
  const base = out || src;
  const host = hostOf(oldThumb);
  let nextThumb = oldThumb;
  let reason = "";

  const ytId = extractYoutubeId(oldThumb) || extractYoutubeId(out) || extractYoutubeId(src);
  if ((host === "i.ytimg.com" || host === "img.youtube.com") && ytId) {
    // Use a stable default YouTube thumbnail variant as fallback.
    nextThumb = `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`;
    reason = "yt_fallback";
  } else if (host.includes("image.thum.io")) {
    const target = decodeThumioTarget(oldThumb) || base;
    if (target) {
      nextThumb = thumio(target);
      reason = "thumio_rebuilt";
    }
  } else if (
    host.includes("sp-uploads.s3.amazonaws.com") ||
    host.includes("s3-eu-west-1.amazonaws.com") ||
    host.includes("jackiecheung.nl") ||
    host.includes("upload.wikimedia.org")
  ) {
    if (base) {
      nextThumb = thumio(base);
      reason = "screenshot_fallback";
    }
  } else if (!oldThumb && base) {
    nextThumb = thumio(base);
    reason = "fill_missing";
  }

  if (nextThumb && nextThumb !== oldThumb) {
    rec.thumbnailUrl = nextThumb;
    changed += 1;
    if (reason === "yt_fallback") ytFallback += 1;
    if (reason === "thumio_rebuilt") thumioFixed += 1;
    if (reason === "screenshot_fallback" || reason === "fill_missing") screenshotFallback += 1;
    updates.push({ id: rec.id, reason, from: oldThumb, to: nextThumb });
  }
}

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
fs.writeFileSync(
  REPORT_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      queueCount: queue.length,
      processed,
      changed,
      ytFallback,
      thumioFixed,
      screenshotFallback,
      missing,
      updates,
    },
    null,
    2
  )
);

console.log(
  JSON.stringify({ queueCount: queue.length, processed, changed, ytFallback, thumioFixed, screenshotFallback, missing }, null, 2)
);
console.log(`Wrote ${REPORT_PATH}`);
