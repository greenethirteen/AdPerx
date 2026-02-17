import fs from "node:fs";
import path from "node:path";

const DATA_PATH = path.resolve("data/campaigns.json");
const REPORT_PATH = path.resolve("data/repair_remaining_thumbnails.report.json");
const TIMEOUT_MS = Math.max(3000, Number(process.env.REQUEST_TIMEOUT_MS || "9000"));

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
    if (!/^https?:\/\//i.test(target)) return "";
    return target;
  } catch {
    return "";
  }
}

function thumio(url) {
  const basis = clean(url);
  if (!basis || !/^https?:\/\//i.test(basis)) return "";
  return `https://image.thum.io/get/width/1200/noanimate/${basis}`;
}

async function checkImage(url) {
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "AdPerxThumbFix/1.0", accept: "image/*,*/*;q=0.8" },
    });
    if (!res.ok || res.status === 403 || res.status === 405) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "AdPerxThumbFix/1.0", accept: "image/*,*/*;q=0.8" },
      });
    }
    if (!res.ok) return false;
    const ct = String(res.headers.get("content-type") || "").toLowerCase();
    return ct.startsWith("image/") || ct.includes("binary/octet-stream");
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

let checked = 0;
let changed = 0;
let fixedYoutube = 0;
let fixedThumio = 0;
let fallbackScreens = 0;
const updated = [];

for (const row of data) {
  const thumb = clean(row.thumbnailUrl);
  if (!thumb) continue;

  const host = hostOf(thumb);
  const suspectThumb =
    host === "i.ytimg.com" ||
    host === "img.youtube.com" ||
    host.includes("image.thum.io") ||
    host.includes("sp-uploads.s3.amazonaws.com") ||
    host.includes("s3-eu-west-1.amazonaws.com") ||
    host.includes("jackiecheung.nl");

  if (!suspectThumb) continue;
  checked += 1;

  const out = clean(row.outboundUrl);
  const src = clean(row.sourceUrl);
  const base = out || src;

  const ytId = extractYoutubeId(thumb) || extractYoutubeId(out) || extractYoutubeId(src);
  if (ytId) {
    const cands = [
      `https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg`,
      `https://i.ytimg.com/vi/${ytId}/sddefault.jpg`,
      `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${ytId}/mqdefault.jpg`,
      `https://i.ytimg.com/vi/${ytId}/default.jpg`,
    ];
    let best = "";
    for (const c of cands) {
      // eslint-disable-next-line no-await-in-loop
      if (await checkImage(c)) {
        best = c;
        break;
      }
    }
    if (best && best !== thumb) {
      row.thumbnailUrl = best;
      changed += 1;
      fixedYoutube += 1;
      updated.push({ id: row.id, type: "youtube", to: best });
      continue;
    }
  }

  if (host.includes("image.thum.io")) {
    const target = decodeThumioTarget(thumb) || base;
    const repaired = thumio(target);
    if (repaired && repaired !== thumb) {
      row.thumbnailUrl = repaired;
      changed += 1;
      fixedThumio += 1;
      updated.push({ id: row.id, type: "thumio", to: repaired });
      continue;
    }
  }

  if (base) {
    const screen = thumio(base);
    if (screen && screen !== thumb) {
      row.thumbnailUrl = screen;
      changed += 1;
      fallbackScreens += 1;
      updated.push({ id: row.id, type: "screenshot", to: screen });
    }
  }
}

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
fs.writeFileSync(
  REPORT_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      checked,
      changed,
      fixedYoutube,
      fixedThumio,
      fallbackScreens,
      updated: updated.slice(0, 2000),
    },
    null,
    2
  )
);

console.log(JSON.stringify({ checked, changed, fixedYoutube, fixedThumio, fallbackScreens }, null, 2));
console.log(`Wrote ${REPORT_PATH}`);
