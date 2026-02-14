import fs from "node:fs";
import path from "node:path";

const DATA_PATH = path.resolve("data/campaigns.json");
const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

const EXACT_BAD_THUMBS = new Set([
  "https://lovetheworkmore.com/wp-content/uploads/2021/06/thumbnail-with-correct-ratio-scaled.jpg",
  "https://clios-prod-media.s3.amazonaws.com/wp-content/uploads/2025/04/23143911/CLIOS-Vertical-BlackWhite.png",
  "https://cargocollective.com/_gfx/loadingAnim.gif",
  "https://iknow-zhidao.bdimg.com/static/common-new/widget/menu/img/triangle.47e7008.svg",
  "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png",
  "https://o.quizlet.com/Ye1oaXBYcs7sU67H0PYB5w_b.png",
]);

function clean(raw) {
  return String(raw || "").replace(/&amp;/g, "&").trim();
}

function normalizeText(raw) {
  return clean(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recordKey(r) {
  return [normalizeText(r.title), normalizeText(r.brand), String(r.year || "")].join("||");
}

function extractYoutubeId(url) {
  const raw = clean(url);
  if (!raw) return "";
  let m = raw.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (!m) m = raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (!m) m = raw.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/);
  if (!m) m = raw.match(/\/embed\/([A-Za-z0-9_-]{11})/);
  if (!m) m = raw.match(/\/vi\/([A-Za-z0-9_-]{11})\//);
  return m ? m[1] : "";
}

function extractVimeoId(url) {
  const raw = clean(url);
  if (!raw) return "";
  const m = raw.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
  return m ? m[1] : "";
}

function isKnownBadThumb(url) {
  const t = clean(url);
  if (!t) return true;
  if (EXACT_BAD_THUMBS.has(t)) return true;
  if (/^https?:\/\/(?:www\.)?dandad\.org\/images\/social\.jpg$/i.test(t)) return true;
  if (/^https?:\/\/iknow-zhidao\.bdimg\.com\/.*triangle\.[a-f0-9]+\.svg$/i.test(t)) return true;
  if (/^https?:\/\/cargocollective\.com\/_gfx\/loadingAnim\.gif$/i.test(t)) return true;
  if (/image\.thum\.io/i.test(t)) return true;
  if (/\/default\.jpg($|\?)/i.test(t) && /(?:img|i)\.youtube\.com|ytimg\.com/i.test(t)) return true;
  if (/bing\.com\/ck\//i.test(t)) return true;
  return false;
}

function normalizeYoutubeThumb(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function normalizeVimeoThumb(id) {
  return `https://vumbnail.com/${id}.jpg`;
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const c = clean(v);
    if (c) return c;
  }
  return "";
}

const byKey = new Map();
for (const r of data) {
  const k = recordKey(r);
  if (!k) continue;
  const curr = byKey.get(k) || [];
  curr.push(r);
  byKey.set(k, curr);
}

let upgradedYoutubeThumbs = 0;
let upgradedVimeoThumbs = 0;
let copiedFromDuplicate = 0;
let fixedOutbound = 0;

for (const r of data) {
  const thumb = clean(r.thumbnailUrl);
  const out = clean(r.outboundUrl);
  const src = clean(r.sourceUrl);

  const yid = extractYoutubeId(out) || extractYoutubeId(src) || extractYoutubeId(thumb);
  const vid = extractVimeoId(out) || extractVimeoId(src) || extractVimeoId(thumb);

  if (yid) {
    const next = normalizeYoutubeThumb(yid);
    if (thumb !== next) {
      r.thumbnailUrl = next;
      upgradedYoutubeThumbs += 1;
    }
    if (!out) {
      r.outboundUrl = `https://www.youtube.com/watch?v=${yid}`;
      fixedOutbound += 1;
    }
    continue;
  }

  if (vid && (isKnownBadThumb(thumb) || !thumb)) {
    const next = normalizeVimeoThumb(vid);
    if (thumb !== next) {
      r.thumbnailUrl = next;
      upgradedVimeoThumbs += 1;
    }
    if (!out) {
      r.outboundUrl = `https://vimeo.com/${vid}`;
      fixedOutbound += 1;
    }
    continue;
  }

  if ((!out || isKnownBadThumb(thumb)) && r.title && r.brand) {
    const peers = byKey.get(recordKey(r)) || [];
    const donor = peers.find((p) => p !== r && clean(p.outboundUrl) && !isKnownBadThumb(p.thumbnailUrl));
    if (donor) {
      const donorOut = clean(donor.outboundUrl);
      const donorThumb = clean(donor.thumbnailUrl);
      let changed = false;
      if (!out && donorOut) {
        r.outboundUrl = donorOut;
        fixedOutbound += 1;
        changed = true;
      }
      if ((isKnownBadThumb(thumb) || !thumb) && donorThumb) {
        r.thumbnailUrl = donorThumb;
        changed = true;
      }
      if (changed) copiedFromDuplicate += 1;
    }
  }

  if ((isKnownBadThumb(clean(r.thumbnailUrl)) || !clean(r.thumbnailUrl)) && clean(r.outboundUrl || r.sourceUrl)) {
    // Last-resort non-broken visual: screenshot preview of the best available case link.
    const basis = firstNonEmpty(r.outboundUrl, r.sourceUrl);
    r.thumbnailUrl = `https://image.thum.io/get/width/1200/noanimate/${encodeURIComponent(basis)}`;
  }
}

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
console.log(JSON.stringify({
  total: data.length,
  upgradedYoutubeThumbs,
  upgradedVimeoThumbs,
  copiedFromDuplicate,
  fixedOutbound,
}, null, 2));
