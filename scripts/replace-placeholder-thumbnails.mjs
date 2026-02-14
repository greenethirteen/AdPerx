import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import path from "node:path";

const DATA_PATH = path.resolve("data/campaigns.json");
const PROGRESS_PATH = path.resolve("data/replace_placeholder.progress.json");
const PLACEHOLDER = "https://lovetheworkmore.com/wp-content/uploads/2021/06/thumbnail-with-correct-ratio-scaled.jpg";

const MAX_ITEMS = Math.max(1, Number(process.env.MAX_ITEMS || "1000"));
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || "12"));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.REQUEST_TIMEOUT_MS || "12000"));
const SAVE_EVERY = Math.max(10, Number(process.env.SAVE_EVERY || "25"));
const RESUME = process.env.RESUME !== "0";
const FORCE_RETRY = process.env.FORCE_RETRY === "1";
const SCREENSHOT_FALLBACK = process.env.SCREENSHOT_FALLBACK !== "0";

function normalizeUrl(raw) {
  return String(raw || "").replace(/&amp;/g, "&").trim();
}

function decodeBingRedirect(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("bing.com") || !u.pathname.startsWith("/ck/")) return "";
    let payload = u.searchParams.get("u") || "";
    if (!payload) return "";
    if (payload.startsWith("a1")) payload = payload.slice(2);
    payload = payload.replace(/-/g, "+").replace(/_/g, "/");
    payload += "=".repeat((4 - (payload.length % 4)) % 4);
    const decoded = Buffer.from(payload, "base64").toString("utf8").trim();
    return /^https?:\/\//i.test(decoded) ? decoded : "";
  } catch {
    return "";
  }
}

function cleanCaseUrl(raw) {
  const url = normalizeUrl(raw);
  if (!/^https?:\/\//i.test(url)) return "";
  const decoded = decodeBingRedirect(url) || url;
  try {
    const u = new URL(decoded);
    if (u.protocol === "http:") u.protocol = "https:";
    u.hash = "";
    return u.toString();
  } catch {
    return decoded;
  }
}

function extractYoutubeId(url) {
  if (!url) return "";
  let m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (!m) m = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (!m) m = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}

function extractVimeoId(url) {
  if (!url) return "";
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
  return m ? m[1] : "";
}

function isImageLikeUrl(raw) {
  if (!raw || !/^https?:\/\//i.test(raw)) return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const p = u.pathname.toLowerCase();
    if (/\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)$/.test(p)) return true;
    if (/ytimg\.com$/.test(host) && /\/(maxresdefault|hqdefault|mqdefault|default|sddefault)\.jpg$/.test(p)) return true;
    if (host.includes("vimeocdn.com")) return true;
    if (host.includes("adsoftheworld.com") && p.includes("/thumbnail_")) return true;
    if (host.includes("builder.io") || host.includes("filespin.io") || host.includes("prezly.com") || host.includes("cloudfront.net")) return true;
  } catch {
    return false;
  }
  return false;
}

function absoluteUrl(raw, base) {
  try {
    return new URL(raw, base).toString();
  } catch {
    return "";
  }
}

function extractImageFromHtml(html, baseUrl) {
  const head = html.slice(0, 300000);
  const patterns = [
    /property=["']og:image["'][^>]*content=["']([^"']+)/i,
    /name=["']twitter:image["'][^>]*content=["']([^"']+)/i,
    /property=["']twitter:image["'][^>]*content=["']([^"']+)/i,
    /itemprop=["']image["'][^>]*content=["']([^"']+)/i,
    /rel=["']image_src["'][^>]*href=["']([^"']+)/i,
    /name=["']thumbnail["'][^>]*content=["']([^"']+)/i,
  ];

  for (const rx of patterns) {
    const m = head.match(rx);
    if (!m?.[1]) continue;
    const img = absoluteUrl(m[1], baseUrl);
    if (img && img !== PLACEHOLDER && isImageLikeUrl(img)) return img;
  }

  const imgMatch = head.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1]) {
    const img = absoluteUrl(imgMatch[1], baseUrl);
    if (img && img !== PLACEHOLDER && isImageLikeUrl(img) && !/logo|icon|sprite/i.test(img)) return img;
  }
  return "";
}

function requestHtml(url) {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      resolve("");
      return;
    }

    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers: {
          "user-agent": "Mozilla/5.0",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          const next = absoluteUrl(res.headers.location, url);
          res.resume();
          requestHtml(next).then(resolve);
          return;
        }
        if (status < 200 || status >= 400) {
          res.resume();
          resolve("");
          return;
        }

        const chunks = [];
        let total = 0;
        let settled = false;
        const done = (val) => {
          if (settled) return;
          settled = true;
          resolve(val);
        };

        res.on("data", (c) => {
          if (total > 350000) return;
          chunks.push(c);
          total += c.length;
        });
        res.on("end", () => {
          let raw = Buffer.concat(chunks);
          const enc = (res.headers["content-encoding"] || "").toLowerCase();
          try {
            if (enc.includes("br")) raw = zlib.brotliDecompressSync(raw);
            else if (enc.includes("gzip")) raw = zlib.gunzipSync(raw);
            else if (enc.includes("deflate")) raw = zlib.inflateSync(raw);
          } catch {}
          done(raw.toString("utf8").slice(0, 300000));
        });
        res.on("error", () => done(""));
        res.on("close", () => done(Buffer.concat(chunks).toString("utf8").slice(0, 300000)));
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve(""));
    req.end();
  });
}

function save(data, progress) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const targets = data
  .map((r, idx) => ({ r, idx }))
  .filter(({ r }) => normalizeUrl(r.thumbnailUrl) === PLACEHOLDER)
  .map(({ idx }) => idx);

let start = 0;
if (RESUME && fs.existsSync(PROGRESS_PATH)) {
  try {
    start = Number(JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8")).next || 0);
  } catch {
    start = 0;
  }
}
if (FORCE_RETRY || start >= targets.length) start = 0;
const end = Math.min(targets.length, start + MAX_ITEMS);

let checked = 0;
let replaced = 0;
let youtubeSet = 0;
let vimeoSet = 0;
let pageImageSet = 0;
let screenshotSet = 0;
let failed = 0;
let ptr = start;

console.log(`Placeholder targets: ${targets.length}. Processing ${end > start ? `${start}..${end - 1}` : "none"}`);

async function processTarget(pos) {
  const rec = data[targets[pos]];
  checked += 1;

  const candidates = [];
  const seen = new Set();
  for (const raw of [rec.outboundUrl, rec.sourceUrl, rec.caseStudyUrl]) {
    const u = cleanCaseUrl(raw || "");
    if (!u || seen.has(u)) continue;
    seen.add(u);
    candidates.push(u);
  }

  for (const u of candidates) {
    const yid = extractYoutubeId(u);
    if (yid) {
      rec.thumbnailUrl = `https://i.ytimg.com/vi/${yid}/hqdefault.jpg`;
      replaced += 1;
      youtubeSet += 1;
      return;
    }
    const vid = extractVimeoId(u);
    if (vid) {
      rec.thumbnailUrl = `https://vumbnail.com/${vid}.jpg`;
      replaced += 1;
      vimeoSet += 1;
      return;
    }
  }

  for (const u of candidates) {
    const html = await requestHtml(u);
    if (!html) continue;
    const img = extractImageFromHtml(html, u);
    if (img) {
      rec.thumbnailUrl = img;
      replaced += 1;
      pageImageSet += 1;
      return;
    }
  }

  if (SCREENSHOT_FALLBACK && candidates[0]) {
    rec.thumbnailUrl = `https://image.thum.io/get/width/1200/noanimate/${encodeURIComponent(candidates[0])}`;
    replaced += 1;
    screenshotSet += 1;
    return;
  }

  failed += 1;
}

async function worker() {
  while (true) {
    const pos = ptr;
    ptr += 1;
    if (pos >= end) return;
    await processTarget(pos);

    if (checked % SAVE_EVERY === 0) {
      save(data, {
        next: pos + 1,
        checked,
        replaced,
        youtubeSet,
        vimeoSet,
        pageImageSet,
        screenshotSet,
        failed,
        updatedAt: new Date().toISOString(),
      });
      console.log(`Progress: checked ${checked}, replaced ${replaced}, searched ${checked}, failed ${failed}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
save(data, {
  next: end,
  checked,
  replaced,
  youtubeSet,
  vimeoSet,
  pageImageSet,
  screenshotSet,
  failed,
  updatedAt: new Date().toISOString(),
});
console.log(`Done: checked ${checked}, replaced ${replaced}, youtube ${youtubeSet}, vimeo ${vimeoSet}, page ${pageImageSet}, screenshot ${screenshotSet}, failed ${failed}`);
