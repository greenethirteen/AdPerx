import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import path from "node:path";

const DATA_PATH = path.resolve("data/campaigns.json");
const PROGRESS_PATH = path.resolve("data/repair_broken_thumbnails.progress.json");
const PLACEHOLDER =
  "https://lovetheworkmore.com/wp-content/uploads/2021/06/thumbnail-with-correct-ratio-scaled.jpg";

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || "12"));
const MAX_ITEMS = Math.max(1, Number(process.env.MAX_ITEMS || "1200"));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.REQUEST_TIMEOUT_MS || "10000"));
const SAVE_EVERY = Math.max(10, Number(process.env.SAVE_EVERY || "25"));
const RESUME = process.env.RESUME !== "0";
const REPLACE_THUMIO = process.env.REPLACE_THUMIO === "1";

function clean(raw) {
  return String(raw || "").replace(/&amp;/g, "&").trim();
}

function absoluteUrl(raw, base) {
  try {
    return new URL(raw, base).toString();
  } catch {
    return "";
  }
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

function normalizeCaseUrl(raw) {
  const input = clean(raw);
  if (!/^https?:\/\//i.test(input)) return "";
  const decoded = decodeBingRedirect(input) || input;
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
  if (!m) m = url.match(/\/vi\/([A-Za-z0-9_-]{11})\//);
  return m ? m[1] : "";
}

function extractVimeoId(url) {
  if (!url) return "";
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
  return m ? m[1] : "";
}

function looksImageLike(raw) {
  if (!raw || !/^https?:\/\//i.test(raw)) return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const p = u.pathname.toLowerCase();
    if (/\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)$/.test(p)) return true;
    if (host.includes("i.ytimg.com") || host.includes("img.youtube.com")) return true;
    if (host.includes("vumbnail.com")) return true;
    if (host.includes("i.vimeocdn.com")) return true;
    if (host.includes("image.adsoftheworld.com")) return true;
    if (host.includes("image.thum.io")) return true;
    if (host.includes("builder.io") || host.includes("filespin.io") || host.includes("prezly.com")) return true;
  } catch {
    return false;
  }
  return false;
}

function isThumio(url) {
  try {
    return new URL(url).hostname.toLowerCase().includes("image.thum.io");
  } catch {
    return false;
  }
}

function requestRaw(url, method = "GET") {
  return new Promise((resolve) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      resolve({ ok: false, status: 0, headers: {}, body: Buffer.alloc(0) });
      return;
    }

    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method,
        headers: {
          "user-agent": "Mozilla/5.0",
          accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          const next = absoluteUrl(res.headers.location, url);
          res.resume();
          requestRaw(next, method).then(resolve);
          return;
        }

        const chunks = [];
        let total = 0;
        res.on("data", (c) => {
          if (method !== "GET") return;
          if (total > 250000) return;
          chunks.push(c);
          total += c.length;
        });
        res.on("end", () => {
          let body = Buffer.concat(chunks);
          const enc = (res.headers["content-encoding"] || "").toLowerCase();
          try {
            if (enc.includes("br")) body = zlib.brotliDecompressSync(body);
            else if (enc.includes("gzip")) body = zlib.gunzipSync(body);
            else if (enc.includes("deflate")) body = zlib.inflateSync(body);
          } catch {}
          resolve({ ok: status >= 200 && status < 300, status, headers: res.headers, body });
        });
        res.on("error", () => resolve({ ok: false, status, headers: res.headers || {}, body: Buffer.alloc(0) }));
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("timeout")));
    req.on("error", () => resolve({ ok: false, status: 0, headers: {}, body: Buffer.alloc(0) }));
    req.end();
  });
}

async function isWorkingImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  const head = await requestRaw(url, "HEAD");
  let status = head.status;
  let ctype = String(head.headers["content-type"] || "").toLowerCase();
  if (status === 405 || status === 0 || !ctype) {
    const get = await requestRaw(url, "GET");
    status = get.status;
    ctype = String(get.headers["content-type"] || "").toLowerCase();
    if (status >= 200 && status < 300 && ctype.startsWith("image/")) return true;
    return false;
  }
  return status >= 200 && status < 300 && ctype.startsWith("image/");
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
    if (img && img !== PLACEHOLDER && looksImageLike(img)) return img;
  }
  return "";
}

async function requestHtml(url) {
  const res = await requestRaw(url, "GET");
  if (!res.ok) return "";
  const ctype = String(res.headers["content-type"] || "").toLowerCase();
  if (!ctype.includes("text/html")) return "";
  return res.body.toString("utf8").slice(0, 300000);
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const targets = data
  .map((r, idx) => ({ r, idx }))
  .filter(({ r }) => r.thumbnailUrl)
  .map(({ idx }) => idx);

let start = 0;
if (RESUME && fs.existsSync(PROGRESS_PATH)) {
  try {
    start = Number(JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8")).next || 0);
  } catch {
    start = 0;
  }
}
if (start >= targets.length) start = 0;
const end = Math.min(targets.length, start + MAX_ITEMS);

let checked = 0;
let kept = 0;
let repaired = 0;
let failed = 0;
let ptr = start;

function save(progress) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

async function repairRecord(rec) {
  const candidates = [];

  // Preferred: canonical video thumbnails if we can infer IDs.
  for (const raw of [rec.outboundUrl, rec.sourceUrl, rec.caseStudyUrl, rec.thumbnailUrl]) {
    const u = normalizeCaseUrl(raw || "");
    if (!u) continue;
    const yid = extractYoutubeId(u);
    if (yid) candidates.push(`https://i.ytimg.com/vi/${yid}/default.jpg`);
    const vid = extractVimeoId(u);
    if (vid) candidates.push(`https://vumbnail.com/${vid}.jpg`);
  }

  // Existing thumbnail may be okay after normalization.
  if (rec.thumbnailUrl) {
    const t = clean(rec.thumbnailUrl);
    if (t !== PLACEHOLDER && looksImageLike(t)) candidates.push(t);
  }

  // Scrape page image metadata from outbound/source/case page.
  for (const raw of [rec.outboundUrl, rec.sourceUrl, rec.caseStudyUrl]) {
    const u = normalizeCaseUrl(raw || "");
    if (!u) continue;
    const html = await requestHtml(u);
    if (!html) continue;
    const img = extractImageFromHtml(html, u);
    if (img) candidates.push(img);
  }

  // Guaranteed fallback that always renders something.
  const basis = normalizeCaseUrl(rec.outboundUrl || rec.sourceUrl || rec.caseStudyUrl || "");
  if (basis) candidates.push(`https://image.thum.io/get/width/1200/noanimate/${encodeURIComponent(basis)}`);

  const seen = new Set();
  for (const c of candidates) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    if (await isWorkingImage(c)) return c;
  }
  return "";
}

async function processTarget(pos) {
  const rec = data[targets[pos]];
  checked += 1;

  const current = clean(rec.thumbnailUrl || "");
  if (
    current &&
    current !== PLACEHOLDER &&
    (!REPLACE_THUMIO || !isThumio(current)) &&
    looksImageLike(current) &&
    (await isWorkingImage(current))
  ) {
    kept += 1;
    return;
  }

  const replacement = await repairRecord(rec);
  if (replacement) {
    rec.thumbnailUrl = replacement;
    repaired += 1;
  } else {
    failed += 1;
  }
}

async function worker() {
  while (true) {
    const pos = ptr;
    ptr += 1;
    if (pos >= end) return;
    await processTarget(pos);
    if (checked % SAVE_EVERY === 0) {
      save({ next: pos + 1, checked, kept, repaired, failed, updatedAt: new Date().toISOString() });
      console.log(`Progress: checked ${checked}, kept ${kept}, repaired ${repaired}, failed ${failed}`);
    }
  }
}

console.log(`Repairing thumbnail URLs: ${targets.length} records. Processing ${start}..${Math.max(start, end - 1)}`);
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
save({ next: end, checked, kept, repaired, failed, updatedAt: new Date().toISOString() });
console.log(`Done: checked ${checked}, kept ${kept}, repaired ${repaired}, failed ${failed}`);
