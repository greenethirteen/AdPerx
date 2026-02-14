import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const campaignsPath = path.join(root, 'data', 'campaigns.json');
const queuePath = path.join(root, 'data', 'link_fix_queue.json');
const outReportPath = path.join(root, 'data', 'youtube_recover_report.json');

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || '6'));
const MAX_ITEMS = Math.max(1, Number(process.env.MAX_ITEMS || '1200'));
const REQUEST_TIMEOUT_MS = Math.max(4000, Number(process.env.REQUEST_TIMEOUT_MS || '12000'));
const MIN_SCORE = Number(process.env.MIN_SCORE || '0.34');
const TARGET_HOSTS = (process.env.TARGET_HOSTS || 'clios.com,dandad.org,adsoftheworld.com,lbbonline.com,behance.net,adsspot.me')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

function normalize(s) {
  return (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s) {
  return new Set(normalize(s).split(' ').filter((t) => t.length >= 3));
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
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

function thumbFromId(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

function scoreCandidate(row, candidateTitle) {
  const wanted = new Set([
    ...tokens(row.title),
    ...tokens(row.brand),
    ...tokens(String(row.year || '')),
    ...tokens(row.agency || row.client || '')
  ]);
  const got = tokens(candidateTitle);
  if (!wanted.size || !got.size) return 0;
  let overlap = 0;
  for (const t of wanted) if (got.has(t)) overlap += 1;
  return overlap / Math.max(4, Math.min(14, wanted.size));
}

async function fetchText(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: c.signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
      }
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

async function youtubeOembedOk(videoId) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
  try {
    const u = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(u, { method: 'GET', redirect: 'follow', signal: c.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function searchYoutube(query) {
  const html = await fetchText(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
  if (!html) return [];
  const out = [];
  const seen = new Set();
  const rx = /"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,500}?"title":\{"runs":\[\{"text":"([^\"]+)/g;
  let m;
  while ((m = rx.exec(html)) && out.length < 40) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: m[2] || '' });
  }
  return out;
}

async function runPool(items, worker, concurrency) {
  let i = 0;
  const out = [];
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      out[idx] = await worker(items[idx], idx);
      if ((idx + 1) % 25 === 0) console.log(`Processed ${idx + 1}/${items.length}`);
    }
  });
  await Promise.all(runners);
  return out;
}

if (!fs.existsSync(campaignsPath) || !fs.existsSync(queuePath)) {
  console.error('Missing campaigns or link_fix_queue file');
  process.exit(1);
}

const campaigns = JSON.parse(fs.readFileSync(campaignsPath, 'utf8'));
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf8'));
const currentById = new Map(campaigns.map((c) => [c.id, c]));

const unresolved = queue.filter((q) => {
  const c = currentById.get(q.id);
  if (!c || !c.outboundUrl) return false;
  return c.outboundUrl === q.url;
});

const targeted = unresolved.filter((q) => {
  const h = hostOf(q.url);
  return TARGET_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}).slice(0, MAX_ITEMS);

console.log(`Unresolved in queue: ${unresolved.length}`);
console.log(`Targeted for YouTube-first (${TARGET_HOSTS.join(', ')}): ${targeted.length}`);

let replaced = 0;
let searched = 0;
let skippedLowScore = 0;
let unavailable = 0;
let noCandidates = 0;
const changed = [];

await runPool(targeted, async (q) => {
  const c = currentById.get(q.id);
  if (!c) return;

  const query = `${c.title || ''} ${c.brand || ''} ${c.year || ''} ad case study`;
  searched += 1;
  const candidates = await searchYoutube(query);
  if (!candidates.length) {
    noCandidates += 1;
    return;
  }

  const scored = candidates
    .map((x) => ({ ...x, score: scoreCandidate(c, x.title) }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score < MIN_SCORE) {
    skippedLowScore += 1;
    return;
  }

  const ok = await youtubeOembedOk(top.id);
  if (!ok) {
    unavailable += 1;
    return;
  }

  const newUrl = `https://www.youtube.com/watch?v=${top.id}`;
  if (c.outboundUrl !== newUrl) {
    c.outboundUrl = newUrl;
    c.thumbnailUrl = thumbFromId(top.id);
    replaced += 1;
    changed.push({ id: c.id, title: c.title, brand: c.brand, oldUrl: q.url, newUrl, score: Number(top.score.toFixed(3)) });
  }
}, CONCURRENCY);

fs.writeFileSync(campaignsPath, JSON.stringify(campaigns, null, 2));
const report = {
  generatedAt: new Date().toISOString(),
  unresolved: unresolved.length,
  targeted: targeted.length,
  replaced,
  searched,
  skippedLowScore,
  noCandidates,
  unavailable,
  minScore: MIN_SCORE,
  changed
};
fs.writeFileSync(outReportPath, JSON.stringify(report, null, 2));

console.log('Done:', { replaced, searched, skippedLowScore, noCandidates, unavailable });
console.log(`Wrote ${outReportPath}`);
