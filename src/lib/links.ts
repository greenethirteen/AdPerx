import type { Campaign } from "@/lib/types";

function normalizeUrl(raw: string) {
  return (raw || "").replace(/&amp;/g, "&").trim();
}

export function isLoveTheWorkMoreUrl(raw: string) {
  const url = normalizeUrl(raw);
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return new URL(url).hostname.toLowerCase().includes("lovetheworkmore.com");
  } catch {
    return false;
  }
}

function decodeThumioTarget(url: URL) {
  if (!url.hostname.includes("image.thum.io")) return "";
  const marker = "/noanimate/";
  const idx = url.pathname.indexOf(marker);
  if (idx < 0) return "";
  const encoded = url.pathname.slice(idx + marker.length);
  if (!encoded) return "";
  try {
    let out = encoded;
    for (let i = 0; i < 6; i += 1) {
      try {
        const dec = decodeURIComponent(out);
        if (dec === out) break;
        out = dec;
      } catch {
        break;
      }
    }
    return out;
  } catch {
    return encoded;
  }
}

function isBlockedScreenshotTarget(rawTarget: string) {
  if (!rawTarget) return false;
  let target = rawTarget.trim();
  // thum.io may receive encoded nested URLs more than once.
  for (let i = 0; i < 6; i += 1) {
    try {
      const dec = decodeURIComponent(target);
      if (dec === target) break;
      target = dec;
    } catch {
      break;
    }
  }
  try {
    const u = new URL(target);
    const host = u.hostname.toLowerCase();
    return (
      host.includes("docs.google.com") ||
      host.includes("zhidao.baidu.com") ||
      host === "bing.com" ||
      host.endsWith(".bing.com")
    );
  } catch {
    return /bing/i.test(target);
  }
}

function decodeBingRedirect(url: string) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes("bing.com") || !u.pathname.startsWith("/ck/")) return "";
    const enc = u.searchParams.get("u") || "";
    if (!enc) return "";

    let payload = enc;
    if (payload.startsWith("a1")) payload = payload.slice(2);
    payload = payload.replace(/-/g, "+").replace(/_/g, "/");

    const padLen = (4 - (payload.length % 4)) % 4;
    payload = payload + "=".repeat(padLen);

    let decoded = "";
    if (typeof atob === "function") {
      decoded = atob(payload);
    }
    decoded = decoded.trim();
    if (/^https?:\/\//i.test(decoded)) return decoded;
    return "";
  } catch {
    return "";
  }
}

export function cleanCaseUrl(raw: string) {
  const url = normalizeUrl(raw);
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) return "";
  const decoded = decodeBingRedirect(url) || url;
  try {
    const u = new URL(decoded);
    if (u.protocol === "http:") u.protocol = "https:";
    // Avoid giant text-fragment anchors that often fail or are noisy.
    u.hash = "";
    return u.toString();
  } catch {
    return decoded;
  }
}

function getHostname(raw: string) {
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isYoutubeUrl(raw: string) {
  const host = getHostname(raw);
  return host === "youtu.be" || host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com");
}

function isIspotUrl(raw: string) {
  const host = getHostname(raw);
  return host === "ispot.tv" || host.endsWith(".ispot.tv");
}

export function getBestCampaignLink(campaign: Campaign) {
  const out = cleanCaseUrl(campaign.outboundUrl || "");
  const src = cleanCaseUrl(campaign.sourceUrl || "");
  const candidates = [out, src].filter((u) => u && !isLoveTheWorkMoreUrl(u));
  if (!candidates.length) return "";

  // 1) Always prefer YouTube when present.
  const youtube = candidates.find((u) => isYoutubeUrl(u));
  if (youtube) return youtube;

  // 2) Then prefer any non-iSpot case-study URL (e.g. Vimeo, D&AD, brand site).
  const nonIspot = candidates.find((u) => !isIspotUrl(u));
  if (nonIspot) return nonIspot;

  // 3) Fall back to iSpot only if no better source exists.
  const ispot = candidates.find((u) => isIspotUrl(u));
  if (ispot) return ispot;

  return "";
}

export function isRenderableThumbnailUrl(raw: string) {
  const url = normalizeUrl(raw);
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host.includes("image.thum.io") && isBlockedScreenshotTarget(decodeThumioTarget(u))) return false;
    if (/\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)$/.test(path)) return true;
    if (/ytimg\.com$/.test(host) && /\/(maxresdefault|hqdefault|mqdefault|default|sddefault)\.jpg$/.test(path)) {
      return true;
    }
    if (host.includes("vumbnail.com")) return true;
    if (host.includes("i.vimeocdn.com")) return true;
    if (host.includes("image.thum.io")) return true;
    if (host === "image.adsoftheworld.com") return true;
    if (host.includes("builder.io") || host.includes("filespin.io") || host.includes("prezly.com")) return true;
    if (host.includes("adsoftheworld.com") && path.includes("/thumbnail_")) return true;
    return false;
  } catch {
    return false;
  }
}

export function getPreferredThumbnailUrl(raw: string) {
  const url = normalizeUrl(raw);
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("image.thum.io") && isBlockedScreenshotTarget(decodeThumioTarget(u))) return "";
  } catch {
    return url;
  }
  return url;
}

export function getNextThumbnailFallback(raw: string) {
  const url = normalizeUrl(raw);
  if (url.includes("/default.jpg")) return "";
  // Step down progressively to reduce "No preview" when only lower variants exist.
  if (url.includes("/maxresdefault.jpg")) return url.replace("/maxresdefault.jpg", "/sddefault.jpg");
  if (url.includes("/sddefault.jpg")) return url.replace("/sddefault.jpg", "/hqdefault.jpg");
  if (url.includes("/hqdefault.jpg")) return url.replace("/hqdefault.jpg", "/mqdefault.jpg");
  if (url.includes("/mqdefault.jpg")) return url.replace("/mqdefault.jpg", "/default.jpg");
  return "";
}

export function buildScreenshotThumbnail(rawCaseUrl: string) {
  const link = cleanCaseUrl(rawCaseUrl);
  if (!link) return "";
  return `https://image.thum.io/get/width/1200/noanimate/${encodeURIComponent(link)}`;
}
