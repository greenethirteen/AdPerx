import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const root = process.cwd();
const campaignsPath = path.join(root, 'data', 'campaigns.json');
const queuePath = path.join(root, 'data', 'link_fix_queue.json');
const reportPath = path.join(root, 'data', 'multisource_recover_report.json');

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || '8'));
const MAX_ITEMS = Math.max(1, Number(process.env.MAX_ITEMS || '2000'));
const START_INDEX = Math.max(0, Number(process.env.START_INDEX || '0'));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number(process.env.REQUEST_TIMEOUT_MS || '10000'));
const MIN_VIDEO_SCORE = Number(process.env.MIN_VIDEO_SCORE || '0.45');
const MIN_WEB_SCORE = Number(process.env.MIN_WEB_SCORE || '0.50');
const MIN_YOUTUBE_META_SCORE = Number(process.env.MIN_YOUTUBE_META_SCORE || '0.26');
const ALLOW_ANY_DOMAIN = process.env.ALLOW_ANY_DOMAIN === '1';

const PREFERRED_HOSTS = (process.env.PREFERRED_HOSTS || [
  'youtube.com','youtu.be','vimeo.com','player.vimeo.com',
  'adsspot.me',
  'dandad.org','liaawards.com','oneclub.org','adfest.com','spikes.asia','www2.spikes.asia',
  'clios.com','lbbonline.com','adsoftheworld.com','canneslions.com'
].join(','))
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

const BAD_HOSTS = new Set([
  'lovetheworkmore.com','bing.com','duckduckgo.com','zhidao.baidu.com','zhihu.com','quizlet.com'
]);

function normalize(text) {
  return (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(text) {
  return new Set(normalize(text).split(' ').filter((t) => t.length >= 3));
}

function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function decodeBody(buf, encoding) {
  const enc = String(encoding || '').toLowerCase();
  try {
    if (enc.includes('br')) return zlib.brotliDecompressSync(buf);
    if (enc.includes('gzip')) return zlib.gunzipSync(buf);
    if (enc.includes('deflate')) return zlib.inflateSync(buf);
  } catch {}
  return buf;
}

function requestUrl(url, { method = 'GET', headers = {}, maxRedirects = 5, maxBytes = 300_000 } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(url); } catch { resolve({ status: 0, headers: {}, body: '', url }); return; }
    const lib = parsed.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const req = lib.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'user-agent': 'AdPerxRecover/1.0',
        'accept-encoding': 'gzip, deflate, br',
        ...headers
      }
    }, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if (location && status >= 300 && status < 400 && maxRedirects > 0) {
        res.resume();
        const next = new URL(location, url).toString();
        requestUrl(next, { method, headers, maxRedirects: maxRedirects - 1, maxBytes }).then(done);
        return;
      }
      const chunks = [];
      let total = 0;
      let destroyedForLimit = false;
      res.on('data', (c) => {
        chunks.push(c);
        total += c.length;
        if (maxBytes && total > maxBytes) {
          destroyedForLimit = true;
          res.destroy();
        }
      });
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const decoded = decodeBody(raw, res.headers['content-encoding']);
        done({ status, headers: res.headers, body: decoded.toString('utf-8').slice(0, maxBytes), url });
      });
      res.on('close', () => {
        if (!destroyedForLimit) return;
        const raw = Buffer.concat(chunks);
        const decoded = decodeBody(raw, res.headers['content-encoding']);
        done({ status, headers: res.headers, body: decoded.toString('utf-8').slice(0, maxBytes), url });
      });
      res.on('error', () => done({ status: 0, headers: {}, body: '', url }));
    });
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy());
    req.on('error', () => done({ status: 0, headers: {}, body: '', url }));
    req.end();
  });
}

async function fetchStatus(url) {
  let res = await requestUrl(url, { method: 'HEAD', maxBytes: 0 });
  if (!res.status || res.status >= 400 || res.status === 405 || res.status === 403) {
    res = await requestUrl(url, { method: 'GET', maxBytes: 10_000 });
  }
  return res.status || 0;
}

function parseYouTubeId(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '').toLowerCase();
    if (h === 'youtu.be') {
      const id = u.pathname.split('/').filter(Boolean)[0] || '';
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : '';
    }
    if (h.endsWith('youtube.com')) {
      const v = u.searchParams.get('v') || '';
      if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const p = u.pathname.split('/').filter(Boolean);
      if ((p[0] === 'shorts' || p[0] === 'embed') && /^[A-Za-z0-9_-]{11}$/.test(p[1] || '')) return p[1];
    }
  } catch {}
  return '';
}

async function youtubeAvailable(videoId) {
  const u = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  const res = await requestUrl(u, { method: 'GET', maxBytes: 20_000 });
  return res.status >= 200 && res.status < 400;
}

async function youtubeMeta(videoId) {
  const u = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
  const res = await requestUrl(u, { method: 'GET', maxBytes: 30_000 });
  if (!(res.status >= 200 && res.status < 400)) return { ok: false, title: '', author: '' };
  try {
    const j = JSON.parse(res.body || '{}');
    return { ok: true, title: String(j.title || ''), author: String(j.author_name || '') };
  } catch {
    return { ok: true, title: '', author: '' };
  }
}

function thumbnailFromUrl(url) {
  const yt = parseYouTubeId(url);
  if (yt) return `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`;
  return '';
}

function scoreMatch(row, title, url) {
  const want = new Set([
    ...tokens(row.title),
    ...tokens(row.brand),
    ...tokens(row.client || ''),
    ...tokens(row.agency || ''),
    ...tokens(String(row.year || '')),
  ]);
  const got = tokens(title || '');
  let overlap = 0;
  for (const t of want) if (got.has(t)) overlap += 1;
  let score = overlap / Math.max(5, Math.min(14, want.size || 5));

  const h = hostOf(url);
  if (h === 'youtube.com' || h === 'youtu.be' || h === 'vimeo.com' || h === 'player.vimeo.com') score += 0.22;
  if (h === 'adsspot.me') score += 0.16;
  if (PREFERRED_HOSTS.some((d) => h === d || h.endsWith(`.${d}`))) score += 0.12;

  const blob = `${(title || '').toLowerCase()} ${String(url).toLowerCase()}`;
  if (row.year && blob.includes(String(row.year))) score += 0.05;
  if (normalize(row.brand || '') && blob.includes(normalize(row.brand || ''))) score += 0.05;

  return score;
}

function inferExpectedFormat(row) {
  const blob = [
    row.awardCategory || '',
    row.categoryBucket || '',
    Array.isArray(row.formatHints) ? row.formatHints.join(' ') : '',
    row.notes || '',
    row.title || ''
  ].join(' ').toLowerCase();

  const hasVideo = /(film|video|tv|cinema|commercial|animation|short film)/.test(blob);
  const hasPrint = /(print|press|outdoor|ooh|poster|billboard|static|idea board|sticker|packaging|radio|audio)/.test(blob);

  if (hasPrint && !hasVideo) return 'print';
  if (hasVideo && !hasPrint) return 'video';
  if (hasPrint && hasVideo) return 'mixed';
  return 'unknown';
}

function adsspotMediaType(url) {
  try {
    const p = new URL(url).pathname.toLowerCase();
    const m = p.match(/\/media\/([^/]+)\//);
    return m?.[1] || '';
  } catch {
    return '';
  }
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractPageSignals(html) {
  const out = { title: '', description: '', text: '' };
  if (!html) return out;
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const m1 = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';
  const d1 = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';
  const d2 = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] || '';
  out.title = decodeEntities((m1 || title || '').trim());
  out.description = decodeEntities((d1 || d2 || '').trim());
  out.text = stripHtml(html).slice(0, 2500);
  return out;
}

function overlapScore(row, text) {
  const want = new Set([
    ...tokens(row.title || ''),
    ...tokens(row.brand || ''),
    ...tokens(row.agency || ''),
    ...tokens(String(row.year || ''))
  ]);
  const got = tokens(text || '');
  let overlap = 0;
  for (const t of want) if (got.has(t)) overlap += 1;
  return overlap / Math.max(5, Math.min(16, want.size || 5));
}

function formatAdjustment(row, url) {
  const expected = inferExpectedFormat(row);
  const h = hostOf(url);
  const isVideoHost = ['youtube.com', 'youtu.be', 'vimeo.com', 'player.vimeo.com'].includes(h);
  const adType = h === 'adsspot.me' ? adsspotMediaType(url) : '';

  let s = 0;
  if (expected === 'print') {
    if (isVideoHost) s -= 0.22;
    if (h === 'adsspot.me') s += 0.20;
    if (adType.includes('print') || adType.includes('outdoor') || adType.includes('ambient')) s += 0.16;
    if (adType.includes('film') || adType.includes('video')) s -= 0.12;
  } else if (expected === 'video') {
    if (isVideoHost) s += 0.16;
    if (h === 'adsspot.me' && (adType.includes('film') || adType.includes('video'))) s += 0.08;
    if (h === 'adsspot.me' && adType.includes('print')) s -= 0.10;
  }
  return s;
}

function adsspotSlugMatchesRow(row, url) {
  if (hostOf(url) !== 'adsspot.me') return true;
  let pathText = '';
  try { pathText = decodeURIComponent(new URL(url).pathname).replace(/[\/_-]+/g, ' ').toLowerCase(); } catch { return false; }
  const stop = new Set(['the','and','for','with','from','campaign','ad','ads','commercial','print','film','tv']);
  const keys = [
    ...tokens(row.title || ''),
    ...tokens(row.brand || '')
  ].filter((t) => t.length >= 4 && !stop.has(t));
  if (!keys.length) return true;
  return keys.some((k) => pathText.includes(k));
}

function normalizeFoundUrl(raw) {
  if (!raw) return '';
  let u = raw.replace(/&amp;/g, '&');
  if (u.startsWith('//')) u = `https:${u}`;
  try {
    const parsed = new URL(u);
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return parsed.toString();
  } catch {
    return '';
  }
}

async function searchYoutube(query) {
  const htmlRes = await requestUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, { maxBytes: 350_000 });
  const html = htmlRes.body || '';
  if (!html) return [];
  const out = [];
  const seen = new Set();
  const rx = /"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,500}?"title":\{"runs":\[\{"text":"([^\"]+)/g;
  let m;
  while ((m = rx.exec(html)) && out.length < 30) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ url: `https://www.youtube.com/watch?v=${id}`, title: m[2] || '' });
  }
  return out;
}

async function searchDuck(query) {
  const res = await requestUrl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { maxBytes: 350_000 });
  const html = res.body || '';
  const out = [];
  const rx = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) && out.length < 16) {
    const u = normalizeFoundUrl(m[1]);
    const t = (m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (u) out.push({ url: u, title: t });
  }
  return out;
}

async function searchBing(query) {
  const res = await requestUrl(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`, { maxBytes: 350_000 });
  const html = res.body || '';
  const out = [];
  const rx = /<li[^>]*class=(?:"|')?b_algo(?:"|')?[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) && out.length < 16) {
    const u = normalizeFoundUrl(m[1]);
    const t = (m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (u) out.push({ url: u, title: t });
  }
  return out;
}

async function searchAdsspot(row) {
  const q = `${row.title || ''} ${row.brand || ''} ${row.year || ''} site:adsspot.me`;
  const [duck, bing] = await Promise.all([searchDuck(q), searchBing(q)]);
  return [...duck, ...bing]
    .map((x) => ({ ...x, source: 'adsspot' }))
    .filter((x) => hostOf(x.url) === 'adsspot.me');
}

function isBadTarget(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, '').toLowerCase();
    const p = `${u.pathname}${u.search}`.toLowerCase();
    if (BAD_HOSTS.has(h)) return true;
    if (h === 'clios.com' && p.includes('/winners-gallery/explore')) return true;
    if (h === 'drive.google.com' && p.includes('/drive/folders/')) return true;
    if (h === 'bing.com' || h === 'duckduckgo.com') return true;
    return false;
  } catch {
    return true;
  }
}

function allowedTarget(url) {
  if (ALLOW_ANY_DOMAIN) return !isBadTarget(url);
  const h = hostOf(url);
  if (!h || isBadTarget(url)) return false;
  return PREFERRED_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

function dedupe(items) {
  const byUrl = new Map();
  for (const x of items) {
    const u = normalizeFoundUrl(x.url || '');
    if (!u) continue;
    const prev = byUrl.get(u);
    if (!prev) {
      byUrl.set(u, { url: u, title: x.title || '', source: x.source || 'web' });
      continue;
    }
    // Keep record with richer title, preserve explicit source when present
    const prevTitleLen = (prev.title || '').length;
    const nextTitleLen = (x.title || '').length;
    if (nextTitleLen > prevTitleLen || (prev.source !== 'youtube' && x.source === 'youtube')) {
      byUrl.set(u, { url: u, title: x.title || '', source: x.source || prev.source || 'web' });
    }
  }
  return [...byUrl.values()];
}

function buildAwardQuery(row) {
  const base = `${row.title || ''} ${row.brand || ''} ${row.year || ''} case study`;
  const sites = [
    'youtube.com','youtu.be','vimeo.com',
    'dandad.org','liaawards.com','oneclub.org','adfest.com','spikes.asia','www2.spikes.asia',
    'clios.com','lbbonline.com','adsoftheworld.com'
  ];
  return `${base} (${sites.map((s)=>`site:${s}`).join(' OR ')})`;
}

async function extractOgImage(url) {
  const res = await requestUrl(url, { method: 'GET', maxBytes: 200_000 });
  if (!(res.status >= 200 && res.status < 400)) return '';
  const html = res.body || '';
  const patterns = [
    /property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /itemprop=["']image["'][^>]*content=["']([^"']+)["']/i,
  ];
  for (const rx of patterns) {
    const m = html.match(rx);
    if (m?.[1]) {
      try { return new URL(m[1], url).toString(); } catch {}
    }
  }
  return '';
}

function extractExternalLinksFromHtml(html, baseUrl) {
  const out = [];
  if (!html) return out;
  const baseHost = hostOf(baseUrl);
  const rx = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) && out.length < 120) {
    const rawHref = decodeEntities(m[1] || '');
    if (!rawHref || rawHref.startsWith('#') || rawHref.startsWith('mailto:')) continue;
    let href = '';
    try { href = new URL(rawHref, baseUrl).toString(); } catch { continue; }
    const h = hostOf(href);
    if (!h || h === baseHost) continue;
    if (['youtube.com', 'youtu.be', 'vimeo.com', 'player.vimeo.com'].includes(h)) continue;
    const title = decodeEntities((m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    out.push({ url: href, title, source: 'source_page' });
  }
  return dedupe(out);
}

async function runPool(items, worker, n) {
  let i = 0;
  const runners = Array.from({ length: n }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      await worker(items[idx], idx);
      if ((idx + 1) % 20 === 0) console.log(`Processed ${idx + 1}/${items.length}`);
    }
  });
  await Promise.all(runners);
}

if (!fs.existsSync(campaignsPath) || !fs.existsSync(queuePath)) {
  console.error('Missing campaigns.json or link_fix_queue.json');
  process.exit(1);
}

const campaigns = JSON.parse(fs.readFileSync(campaignsPath, 'utf8'));
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
const byId = new Map(campaigns.map((c) => [c.id, c]));

const unresolved = queue.filter((q) => {
  const row = byId.get(q.id);
  return row?.outboundUrl && row.outboundUrl === q.url;
});

const targets = unresolved.slice(START_INDEX, START_INDEX + MAX_ITEMS);
console.log(`Unresolved in queue: ${unresolved.length}`);
console.log(`Targets for multi-source recovery: ${targets.length} (slice ${START_INDEX}..${START_INDEX + Math.max(0, targets.length - 1)})`);

let replaced = 0;
let searched = 0;
let noCandidates = 0;
let lowScore = 0;
let unavailable = 0;
let validatedReject = 0;
const bySource = { youtube: 0, web: 0, adsspot: 0, source_page: 0 };
const changed = [];

await runPool(targets, async (q) => {
  const row = byId.get(q.id);
  if (!row) return;

  const baseQuery = `${row.title || ''} ${row.brand || ''} ${row.year || ''} ad case study`;
  let candidates = [];

  if (row.sourceUrl) {
    const src = await requestUrl(row.sourceUrl, { method: 'GET', maxBytes: 350_000 });
    if (src.status >= 200 && src.status < 400) {
      const rawLinks = extractExternalLinksFromHtml(src.body || '', row.sourceUrl);
      const relevantLinks = rawLinks.filter((c) => {
        let pathText = '';
        try { pathText = decodeURIComponent(new URL(c.url).pathname).replace(/[\/_-]+/g, ' '); } catch {}
        const blob = `${c.title || ''} ${pathText}`.trim();
        const rel = overlapScore(row, blob);
        return rel >= 0.28 && adsspotSlugMatchesRow(row, c.url);
      });
      candidates.push(...relevantLinks);
    }
  }

  searched += 1;
  const yt = await searchYoutube(baseQuery);
  if (yt.length) candidates.push(...yt.map((x) => ({ ...x, source: 'youtube' })));

  const awardQuery = buildAwardQuery(row);
  const [duck, bing, adsspot] = await Promise.all([searchDuck(awardQuery), searchBing(awardQuery), searchAdsspot(row)]);
  candidates.push(...duck.map((x) => ({ ...x, source: 'web' })));
  candidates.push(...bing.map((x) => ({ ...x, source: 'web' })));
  candidates.push(...adsspot);

  // Fallback broad web query if strict award query found little/nothing.
  if (candidates.length < 2) {
    const broadQuery = `${row.title || ''} ${row.brand || ''} ${row.year || ''} case study`;
    const [duckBroad, bingBroad] = await Promise.all([searchDuck(broadQuery), searchBing(broadQuery)]);
    candidates.push(...duckBroad.map((x) => ({ ...x, source: 'web' })));
    candidates.push(...bingBroad.map((x) => ({ ...x, source: 'web' })));
  }

  candidates = dedupe(candidates).filter((c) => allowedTarget(c.url));
  if (!candidates.length) { noCandidates += 1; return; }

  const scored = candidates
    .map((c) => ({ ...c, score: scoreMatch(row, c.title, c.url) }))
    .sort((a, b) => b.score - a.score);

  // Read candidate pages and re-rank by textual/format fit.
  const reranked = [];
  for (const c of scored.slice(0, 10)) {
    let extra = formatAdjustment(row, c.url);
    const h = hostOf(c.url);
    if (!['youtube.com', 'youtu.be', 'vimeo.com', 'player.vimeo.com'].includes(h)) {
      const page = await requestUrl(c.url, { method: 'GET', maxBytes: 220_000 });
      if (page.status >= 200 && page.status < 400) {
        const sig = extractPageSignals(page.body || '');
        const textBlob = `${c.title || ''} ${sig.title} ${sig.description} ${sig.text}`;
        extra += overlapScore(row, textBlob) * 0.55;
      }
    }
    reranked.push({ ...c, score: c.score + extra });
  }
  reranked.push(...scored.slice(10));
  reranked.sort((a, b) => b.score - a.score);

  let chosen = null;
  for (const c of reranked.slice(0, 8)) {
    const isVideo = ['youtube.com','youtu.be','vimeo.com','player.vimeo.com'].includes(hostOf(c.url));
    if (isVideo && c.score < MIN_VIDEO_SCORE) continue;
    if (!isVideo && c.score < MIN_WEB_SCORE) continue;
    if (!adsspotSlugMatchesRow(row, c.url)) { validatedReject += 1; continue; }

    if (hostOf(c.url).includes('youtube')) {
      const id = parseYouTubeId(c.url);
      if (!id) continue;
      const ym = await youtubeMeta(id);
      if (!ym.ok) { unavailable += 1; continue; }
      const metaScore = overlapScore(row, `${ym.title} ${ym.author}`);
      if (metaScore < MIN_YOUTUBE_META_SCORE) { validatedReject += 1; continue; }
    }

    const status = await fetchStatus(c.url);
    if (!(status >= 200 && status < 400)) { validatedReject += 1; continue; }

    chosen = c;
    break;
  }

  if (!chosen) { lowScore += 1; return; }

  const oldUrl = row.outboundUrl;
  row.outboundUrl = chosen.url;
  const quickThumb = thumbnailFromUrl(chosen.url);
  if (quickThumb) {
    row.thumbnailUrl = quickThumb;
  } else {
    const og = await extractOgImage(chosen.url);
    if (og) row.thumbnailUrl = og;
  }

  replaced += 1;
  bySource[chosen.source] = (bySource[chosen.source] || 0) + 1;
  changed.push({ id: row.id, title: row.title, brand: row.brand, oldUrl, newUrl: row.outboundUrl, source: chosen.source, score: Number(chosen.score.toFixed(3)) });
}, CONCURRENCY);

fs.writeFileSync(campaignsPath, JSON.stringify(campaigns, null, 2));
const report = {
  generatedAt: new Date().toISOString(),
  unresolved: unresolved.length,
  targets: targets.length,
  replaced,
  bySource,
  searched,
  noCandidates,
  lowScore,
  unavailable,
  validatedReject,
  minVideoScore: MIN_VIDEO_SCORE,
  minWebScore: MIN_WEB_SCORE,
  minYoutubeMetaScore: MIN_YOUTUBE_META_SCORE,
  changed,
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log('Done', { replaced, bySource, searched, noCandidates, lowScore, unavailable, validatedReject });
console.log(`Wrote ${reportPath}`);
