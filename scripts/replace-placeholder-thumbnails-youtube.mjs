import fs from "node:fs";
import path from "node:path";

const DATA_PATH = path.resolve("data/campaigns.json");
const PROGRESS_PATH = path.resolve("data/youtube_thumbnail_replace.progress.json");
const PLACEHOLDER =
  "https://lovetheworkmore.com/wp-content/uploads/2021/06/thumbnail-with-correct-ratio-scaled.jpg";
const BAD_THUMB_HOST_FRAGMENTS = [
  "storage.googleapis.com/adforum-media",
  "portal-assets.imgix.net",
  "adeevee.com",
  "adforum.com",
  "es.adforum.com",
  "forsman.co",
  "ariandfriends.co",
  "jamieandsanjiv.com",
];
const TARGET_MODE = (process.env.TARGET_MODE || "placeholder").toLowerCase();
const MAX_ITEMS = Math.max(1, Number(process.env.MAX_ITEMS || "300"));
const RESUME = process.env.RESUME === "1";
const FORCE_RETRY = process.env.FORCE_RETRY === "1";
const ENABLE_IMAGE_FALLBACK = process.env.ENABLE_IMAGE_FALLBACK === "1";
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.REQUEST_TIMEOUT_MS || "12000"));
const SAVE_EVERY = Math.max(10, Number(process.env.SAVE_EVERY || "25"));
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || "8"));

function normalize(text) {
  return (text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text) {
  return new Set(
    normalize(text)
      .split(" ")
      .filter((t) => t.length >= 3)
  );
}

function extractYoutubeId(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("youtube.com")) {
      const id = u.searchParams.get("v");
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    if (host.includes("youtu.be")) {
      const id = u.pathname.split("/").filter(Boolean)[0];
      if (id && /^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
  } catch {}
  return null;
}

function thumbnailFromId(id) {
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
}

function isLikelyImageUrl(raw) {
  if (!raw || !/^https?:\/\//i.test(raw)) return false;
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    if (/\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)$/.test(path)) return true;
    if (/ytimg\.com$/.test(host) && /\/(maxresdefault|hqdefault|mqdefault|default|sddefault)\.jpg$/.test(path)) return true;
    if (host.includes("adsoftheworld.com") && path.includes("/thumbnail_")) return true;
  } catch {}
  return false;
}

function isKnownBadThumbnail(raw) {
  if (!raw) return false;
  const t = raw.replace(/&amp;/g, "&").trim();
  if (!t) return false;
  if (t === PLACEHOLDER) return true;
  if (
    t ===
    "https://clios-prod-media.s3.amazonaws.com/wp-content/uploads/2025/04/23143911/CLIOS-Vertical-BlackWhite.png"
  ) {
    return true;
  }
  if (/^https?:\/\/(?:www\.)?dandad\.org\/images\/social\.jpg$/i.test(t)) return true;
  if (/^https?:\/\/[^/]+\/_gfx\/loadingAnim\.gif$/i.test(t)) return true;
  if (/^https?:\/\/iknow-zhidao\.bdimg\.com\/.+\/triangle\.[a-f0-9]+\.svg$/i.test(t)) return true;
  try {
    const u = new URL(t);
    const host = u.hostname.toLowerCase();
    if (host.includes("image.thum.io")) return true;
    if (host.includes("bing.com")) return true;
    if (BAD_THUMB_HOST_FRAGMENTS.some((part) => `${host}${u.pathname.toLowerCase()}`.includes(part))) return true;
  } catch {
    return true;
  }
  return !isLikelyImageUrl(t);
}

function shouldTargetRecord(r) {
  const thumb = (r.thumbnailUrl || "").replace(/&amp;/g, "&").trim();
  if (TARGET_MODE === "missing") return !thumb;
  if (TARGET_MODE === "invalid") return !thumb || isKnownBadThumbnail(thumb);
  return thumb === PLACEHOLDER;
}

function scoreCandidate(record, candidateTitle) {
  const targetTokens = new Set([
    ...tokenize(record.title),
    ...tokenize(record.brand),
    ...tokenize(record.client),
  ]);
  if (!targetTokens.size) return 0;
  const candTokens = tokenize(candidateTitle);
  if (!candTokens.size) return 0;
  let overlap = 0;
  for (const t of targetTokens) {
    if (candTokens.has(t)) overlap += 1;
  }
  return overlap / Math.max(4, Math.min(12, targetTokens.size));
}

async function fetchText(url) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

async function searchYoutubeByQuery(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  if (!html) return [];

  // Extract nearby title text and score candidates later.
  const re = /"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,450}?"title":\{"runs":\[\{"text":"([^"]+)/g;
  const out = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) && out.length < 30) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: m[2] || "" });
  }

  return out;
}

function decodeJsonEscapes(s) {
  return s
    .replace(/\\u002f/g, "/")
    .replace(/\\u003a/g, ":")
    .replace(/\\u003d/g, "=")
    .replace(/\\u0026/g, "&")
    .replace(/\\"/g, "\"")
    .replace(/\\\\/g, "\\");
}

async function searchBingImage(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2`;
  const html = await fetchText(url);
  if (!html) return null;

  // Bing image result payload often contains murl in escaped JSON.
  const m = html.match(/murl&quot;:&quot;([^&]+?)&quot;/i);
  if (m?.[1]) {
    const candidate = decodeJsonEscapes(m[1]);
    if (isLikelyImageUrl(candidate) && !isKnownBadThumbnail(candidate)) return candidate;
  }

  // Fallback: first direct image-like URL in markup.
  const f = html.match(/https?:\/\/[^"' ]+\.(?:jpg|jpeg|png|webp)/i);
  const fallback = f?.[0] || null;
  return isLikelyImageUrl(fallback) ? fallback : null;
}

function saveProgress(progress, campaigns) {
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
  fs.writeFileSync(DATA_PATH, JSON.stringify(campaigns, null, 2));
}

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`Missing ${DATA_PATH}`);
  }

  const campaigns = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const targets = campaigns
    .map((r, idx) => ({ idx, r }))
    .filter(({ r }) => shouldTargetRecord(r));

  let start = 0;
  let replaced = 0;
  let imageFallback = 0;
  let checked = 0;
  let searched = 0;
  let failed = 0;

  if (RESUME && fs.existsSync(PROGRESS_PATH)) {
    try {
      const p = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8"));
      start = Number(p.nextIndex || 0);
      replaced = Number(p.replaced || 0);
      imageFallback = Number(p.imageFallback || 0);
      checked = Number(p.checked || 0);
      searched = Number(p.searched || 0);
      failed = Number(p.failed || 0);
    } catch {}
  }

  // Allow reprocessing unresolved placeholders even after reaching prior end.
  if (FORCE_RETRY || start >= targets.length) {
    start = 0;
    checked = 0;
    replaced = 0;
    imageFallback = 0;
    searched = 0;
    failed = 0;
  }

  const end = Math.min(targets.length, start + MAX_ITEMS);
  const rangeText = end > start ? `${start}..${end - 1}` : "none";
  console.log(`Targets(${TARGET_MODE}): ${targets.length}. Processing ${rangeText}`);

  let ptr = start;

  async function processOne(i) {
    const { idx, r } = targets[i];
    checked += 1;

    let ytId =
      extractYoutubeId(r.outboundUrl) ||
      extractYoutubeId(r.sourceUrl) ||
      extractYoutubeId(r.caseStudyUrl);

    if (!ytId) {
      searched += 1;
      const query = `${r.title || ""} ${r.brand || ""} ad case study`;
      const candidates = await searchYoutubeByQuery(query);
      if (candidates.length) {
        candidates.sort((a, b) => scoreCandidate(r, b.title) - scoreCandidate(r, a.title));
        const best = candidates[0];
        if (best && scoreCandidate(r, best.title) >= 0.2) ytId = best.id;
        if (!ytId && best) ytId = best.id;
      }
    }

    if (ytId) {
      campaigns[idx].thumbnailUrl = thumbnailFromId(ytId);
      replaced += 1;
    } else if (ENABLE_IMAGE_FALLBACK) {
      const imgQuery = `${r.title || ""} ${r.brand || ""} campaign case study`;
      const imageUrl = await searchBingImage(imgQuery);
      if (imageUrl) {
        campaigns[idx].thumbnailUrl = imageUrl;
        replaced += 1;
        imageFallback += 1;
      } else {
        failed += 1;
      }
    } else {
      failed += 1;
    }

    if (checked % SAVE_EVERY === 0) {
      saveProgress(
        {
          updatedAt: new Date().toISOString(),
          nextIndex: i + 1,
          checked,
          replaced,
          imageFallback,
          searched,
          failed,
        },
        campaigns
      );
      console.log(
        `Progress: checked ${checked}, replaced ${replaced}, imageFallback ${imageFallback}, searched ${searched}, failed ${failed}`
      );
    }
  }

  async function worker() {
    while (true) {
      const i = ptr;
      ptr += 1;
      if (i >= end) return;
      await processOne(i);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  saveProgress(
    {
      updatedAt: new Date().toISOString(),
      nextIndex: end,
      checked,
      replaced,
      imageFallback,
      searched,
      failed,
    },
    campaigns
  );

  console.log(
    `Done: checked ${checked}, replaced ${replaced}, imageFallback ${imageFallback}, searched ${searched}, failed ${failed}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
