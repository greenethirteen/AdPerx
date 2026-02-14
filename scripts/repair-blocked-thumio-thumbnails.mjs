import fs from 'node:fs';
import path from 'node:path';

const DATA_PATH = path.resolve('data/campaigns.json');
const TIMEOUT_MS = Math.max(3000, Number(process.env.REQUEST_TIMEOUT_MS || '8000'));
const CONCURRENCY = Math.max(2, Number(process.env.CONCURRENCY || '20'));

function decodeTargetFromThumio(url) {
  try {
    const u = new URL(url);
    if (!u.hostname.includes('image.thum.io')) return '';
    const marker = '/noanimate/';
    const idx = u.pathname.indexOf(marker);
    if (idx < 0) return '';
    let target = u.pathname.slice(idx + marker.length);
    for (let i = 0; i < 3; i += 1) {
      try { target = decodeURIComponent(target); } catch { break; }
    }
    return target;
  } catch {
    return '';
  }
}

function isBlockedTarget(raw) {
  try {
    const h = new URL(raw).hostname.toLowerCase();
    return (
      h.includes('lovetheworkmore.com') ||
      h.includes('dandad.org') ||
      h.includes('clios.com') ||
      h.includes('docs.google.com') ||
      h.includes('zhidao.baidu.com') ||
      h === 'bing.com' || h.endsWith('.bing.com')
    );
  } catch {
    return false;
  }
}

function absoluteUrl(raw, base) {
  try { return new URL(raw, base).toString(); } catch { return ''; }
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

function looksImage(url) {
  if (!url || !/^https?:\/\//i.test(url)) return false;
  try {
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const p = u.pathname.toLowerCase();
    if (/\.(jpg|jpeg|png|webp|gif|avif|bmp|svg)$/.test(p)) return true;
    if (h.includes('ytimg.com') || h.includes('vimeocdn.com') || h.includes('vumbnail.com')) return true;
    if (h.includes('cloudfront.net') || h.includes('builder.io') || h.includes('filespin.io') || h.includes('prezly.com')) return true;
  } catch {}
  return false;
}

async function fetchText(url) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return '';
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html')) return '';
    return (await res.text()).slice(0, 300000);
  } catch {
    return '';
  }
}

function extractMetaImage(html, base) {
  const patterns = [
    /property=["']og:image["'][^>]*content=["']([^"']+)/i,
    /name=["']twitter:image["'][^>]*content=["']([^"']+)/i,
    /property=["']twitter:image["'][^>]*content=["']([^"']+)/i,
    /itemprop=["']image["'][^>]*content=["']([^"']+)/i,
    /rel=["']image_src["'][^>]*href=["']([^"']+)/i,
  ];
  for (const rx of patterns) {
    const m = html.match(rx);
    if (!m?.[1]) continue;
    const img = absoluteUrl(m[1], base);
    if (looksImage(img)) return img;
  }
  return '';
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const targets = data
  .map((r, i) => ({ r, i }))
  .filter(({ r }) => {
    const t = (r.thumbnailUrl || '').trim();
    const target = decodeTargetFromThumio(t);
    return t.includes('image.thum.io') && target && isBlockedTarget(target);
  });

let checked = 0;
let replaced = 0;
let failed = 0;
let ptr = 0;

async function processOne(item) {
  const r = item.r;
  const thumb = (r.thumbnailUrl || '').trim();
  const decoded = decodeTargetFromThumio(thumb);
  const bases = [decoded, r.outboundUrl || '', r.sourceUrl || ''].filter(Boolean);

  for (const u of bases) {
    const y = extractYoutubeId(u);
    if (y) {
      r.thumbnailUrl = `https://i.ytimg.com/vi/${y}/hqdefault.jpg`;
      return true;
    }
    const v = extractVimeoId(u);
    if (v) {
      r.thumbnailUrl = `https://vumbnail.com/${v}.jpg`;
      return true;
    }
  }

  for (const u of bases) {
    const html = await fetchText(u);
    if (!html) continue;
    const img = extractMetaImage(html, u);
    if (img) {
      r.thumbnailUrl = img;
      return true;
    }
  }

  return false;
}

async function worker() {
  while (true) {
    const i = ptr;
    ptr += 1;
    if (i >= targets.length) return;
    checked += 1;
    const ok = await processOne(targets[i]);
    if (ok) replaced += 1;
    else failed += 1;
    if (checked % 50 === 0) console.log(`Progress: checked ${checked}, replaced ${replaced}, failed ${failed}`);
  }
}

console.log(`Blocked thum.io targets: ${targets.length}`);
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
console.log(`Done: checked ${checked}, replaced ${replaced}, failed ${failed}`);
