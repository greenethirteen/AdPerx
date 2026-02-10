import fs from "node:fs";
import path from "node:path";

const DATA_PATH = path.resolve("data/campaigns.json");
const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const DROP_THUMIO = process.env.DROP_THUMIO !== "0";

function cleanRaw(raw) {
  return (raw || "").replace(/&amp;/g, "&").trim();
}

function decodeBingRedirect(raw) {
  const url = cleanRaw(raw);
  if (!url) return "";
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

function extractYoutubeId(url) {
  const raw = cleanRaw(url);
  if (!raw) return "";
  try {
    const u = new URL(raw);
    if (u.hostname.includes("youtube.com")) {
      const id = u.searchParams.get("v") || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
    }
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.split("/").filter(Boolean)[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
    }
  } catch {}
  return "";
}

function extractYoutubeIdFromThumb(url) {
  const raw = cleanRaw(url);
  if (!raw) return "";
  try {
    const u = new URL(raw);
    const m = u.pathname.match(/\/vi\/([A-Za-z0-9_-]{11})\//i);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

function looksImageUrl(url) {
  const raw = cleanRaw(url);
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const p = u.pathname.toLowerCase();
    if (/\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)$/.test(p)) return true;
    if (host === "image.adsoftheworld.com") return true;
    if (/ytimg\.com$/.test(host) && /\/(maxresdefault|hqdefault|mqdefault|default|sddefault)\.jpg$/.test(p)) return true;
    if (host.includes("adsoftheworld.com") && p.includes("/thumbnail_")) return true;
    if (/vimeocdn\.com|cloudfront|cdn|img\.|images?\./i.test(host) && u.search.length < 300) return true;
  } catch {}
  return false;
}

function normalizeCaseUrl(raw) {
  const cleaned = cleanRaw(raw);
  if (!/^https?:\/\//i.test(cleaned)) return "";
  const decoded = decodeBingRedirect(cleaned) || cleaned;
  try {
    const u = new URL(decoded);
    if (u.protocol === "http:") u.protocol = "https:";
    u.hash = "";
    return u.toString();
  } catch {
    return decoded;
  }
}

let outboundFixed = 0;
let outboundRemoved = 0;
let thumbMaxresToHq = 0;
let thumbBingRemoved = 0;
let thumbPageRemoved = 0;
let thumbDerivedYoutube = 0;
let thumioRemoved = 0;
let sourceNormalized = 0;
let thumbYoutubeNormalized = 0;
let thumbKnownPlaceholderRemoved = 0;

for (const r of data) {
  const outRaw = cleanRaw(r.outboundUrl || "");
  if (outRaw) {
    const normalized = normalizeCaseUrl(outRaw);
    if (/https?:\/\/(?:www\.)?bing\.com\/ck\//i.test(outRaw) && !normalized) {
      r.outboundUrl = "";
      outboundRemoved += 1;
    } else {
      if (normalized !== outRaw) outboundFixed += 1;
      r.outboundUrl = normalized || outRaw;
    }
  }
  const srcRaw = cleanRaw(r.sourceUrl || "");
  if (srcRaw) {
    const normalizedSrc = normalizeCaseUrl(srcRaw);
    if (normalizedSrc && normalizedSrc !== srcRaw) sourceNormalized += 1;
    r.sourceUrl = normalizedSrc || srcRaw;
  }

  let thumb = cleanRaw(r.thumbnailUrl || "");
  if (!thumb) continue;

  if (/https?:\/\/(?:www\.)?bing\.com\/ck\//i.test(thumb)) {
    thumb = "";
    thumbBingRemoved += 1;
  }

  if (
    /https?:\/\/(?:www\.)?dandad\.org\/images\/social\.jpg$/i.test(thumb) ||
    /https?:\/\/[^/]+\/_gfx\/loadingAnim\.gif$/i.test(thumb) ||
    /https?:\/\/iknow-zhidao\.bdimg\.com\/.*triangle\.[a-f0-9]+\.svg$/i.test(thumb)
  ) {
    thumb = "";
    thumbKnownPlaceholderRemoved += 1;
  }

  if (/\/maxresdefault\.jpg/i.test(thumb)) {
    thumb = thumb.replace(/\/maxresdefault\.jpg/gi, "/default.jpg");
    thumbMaxresToHq += 1;
  }

  if (/ytimg\.com|img\.youtube\.com/i.test(thumb)) {
    const ytFromThumb = extractYoutubeIdFromThumb(thumb);
    const ytFromLink = extractYoutubeId(r.outboundUrl) || extractYoutubeId(r.sourceUrl);
    const yt = ytFromThumb || ytFromLink;
    if (yt) {
      thumb = `https://i.ytimg.com/vi/${yt}/default.jpg`;
      thumbYoutubeNormalized += 1;
    } else {
      thumb = "";
      thumbPageRemoved += 1;
    }
  }

  if (DROP_THUMIO && /image\.thum\.io/i.test(thumb)) {
    thumb = "";
    thumioRemoved += 1;
  }

  if (thumb && !looksImageUrl(thumb)) {
    const yt = extractYoutubeId(r.outboundUrl) || extractYoutubeId(r.sourceUrl);
    if (yt) {
      thumb = `https://img.youtube.com/vi/${yt}/default.jpg`;
      thumbDerivedYoutube += 1;
    } else {
      thumb = "";
      thumbPageRemoved += 1;
    }
  }

  r.thumbnailUrl = thumb;
}

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
console.log("Sanitize complete");
console.log(
  JSON.stringify(
    {
      outboundFixed,
      outboundRemoved,
      thumbMaxresToHq,
      thumbBingRemoved,
      thumbPageRemoved,
      thumbDerivedYoutube,
      thumioRemoved,
      sourceNormalized,
      thumbYoutubeNormalized,
      thumbKnownPlaceholderRemoved,
    },
    null,
    2
  )
);
