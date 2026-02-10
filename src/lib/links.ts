import type { Campaign } from "@/lib/types";

function normalizeUrl(raw: string) {
  return (raw || "").replace(/&amp;/g, "&").trim();
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

export function getBestCampaignLink(campaign: Campaign) {
  const out = cleanCaseUrl(campaign.outboundUrl || "");
  if (out) return out;
  return cleanCaseUrl(campaign.sourceUrl || "");
}

export function isRenderableThumbnailUrl(raw: string) {
  const url = normalizeUrl(raw);
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
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
    const path = u.pathname.toLowerCase();
    // Upgrade low-res YouTube defaults to HQ when available.
    if (/ytimg\.com$/.test(host) && /\/default\.jpg$/.test(path)) {
      return url.replace(/\/default\.jpg$/i, "/hqdefault.jpg");
    }
  } catch {
    return url;
  }
  return url;
}

export function getNextThumbnailFallback(raw: string) {
  const url = normalizeUrl(raw);
  if (url.includes("/maxresdefault.jpg")) return url.replace("/maxresdefault.jpg", "/hqdefault.jpg");
  if (url.includes("/hqdefault.jpg")) return url.replace("/hqdefault.jpg", "/mqdefault.jpg");
  if (url.includes("/mqdefault.jpg")) return url.replace("/mqdefault.jpg", "/default.jpg");
  return "";
}

export function buildScreenshotThumbnail(rawCaseUrl: string) {
  const link = cleanCaseUrl(rawCaseUrl);
  if (!link) return "";
  return `https://image.thum.io/get/width/1200/noanimate/${encodeURIComponent(link)}`;
}
