import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';

const DATA_PATH = path.resolve('data/campaigns.json');
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

const KNOWN_BAD = [
  /^https?:\/\/(?:www\.)?dandad\.org\/images\/social\.jpg$/i,
  /^https?:\/\/cargocollective\.com\/_gfx\/loadingAnim\.gif$/i,
  /^https?:\/\/iknow-zhidao\.bdimg\.com\/.*triangle\.[a-f0-9]+\.svg$/i,
  /^https?:\/\/i\.ytimg\.com\/vi\/UAdgxQjKX3k\/default\.jpg$/i,
];

function clean(raw) {
  return String(raw || '').replace(/&amp;/g, '&').trim();
}

function extractYoutubeId(url) {
  if (!url) return '';
  let m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (!m) m = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (!m) m = url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : '';
}

function extractVimeoId(url) {
  if (!url) return '';
  const m = url.match(/vimeo\.com\/(?:video\/)?(\d{6,12})/);
  return m ? m[1] : '';
}

function normalizeCaseUrl(raw) {
  const v = clean(raw);
  if (!/^https?:\/\//i.test(v)) return '';
  try {
    const u = new URL(v);
    if (u.protocol === 'http:') u.protocol = 'https:';
    u.hash = '';
    return u.toString();
  } catch {
    return '';
  }
}

function headStatus(url) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch { resolve(0); return; }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: `${u.pathname}${u.search}`,
        method: 'HEAD',
        headers: { 'user-agent': 'Mozilla/5.0' },
      },
      (res) => {
        const s = res.statusCode || 0;
        res.resume();
        resolve(s);
      }
    );
    req.setTimeout(7000, () => req.destroy());
    req.on('error', () => resolve(0));
    req.end();
  });
}

function isKnownBad(thumb) {
  const t = clean(thumb);
  return KNOWN_BAD.some((rx) => rx.test(t));
}

let changed = 0;
let replacedYoutube = 0;
let replacedVimeo = 0;
let replacedScreenshot = 0;

for (const r of data) {
  const thumb = clean(r.thumbnailUrl);
  if (!isKnownBad(thumb)) continue;

  const out = normalizeCaseUrl(r.outboundUrl || '');
  const src = normalizeCaseUrl(r.sourceUrl || '');
  const basis = out || src;

  let next = '';

  const yid = extractYoutubeId(out) || extractYoutubeId(src);
  if (yid) {
    const yt = `https://i.ytimg.com/vi/${yid}/hqdefault.jpg`;
    // keep only if actually alive
    const st = await headStatus(yt);
    if (st >= 200 && st < 300) {
      next = yt;
      replacedYoutube += 1;
    }
  }

  if (!next) {
    const vid = extractVimeoId(out) || extractVimeoId(src);
    if (vid) {
      next = `https://vumbnail.com/${vid}.jpg`;
      replacedVimeo += 1;
    }
  }

  if (!next && basis) {
    next = `https://image.thum.io/get/width/1200/noanimate/${encodeURIComponent(basis)}`;
    replacedScreenshot += 1;
  }

  if (next && next !== thumb) {
    r.thumbnailUrl = next;
    changed += 1;
  }
}

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
console.log(JSON.stringify({ changed, replacedYoutube, replacedVimeo, replacedScreenshot }, null, 2));
