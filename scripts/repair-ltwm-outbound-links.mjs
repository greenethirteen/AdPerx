import fs from "node:fs";
import path from "node:path";

const DATA_PATH = path.resolve("data/campaigns.json");
const PROGRESS_PATH = path.resolve("data/repair_ltwm_outbound.progress.json");
const MAX_ITEMS = Math.max(1, Number(process.env.MAX_ITEMS || "500"));
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || "6"));
const REQUEST_TIMEOUT_MS = Math.max(4000, Number(process.env.REQUEST_TIMEOUT_MS || "12000"));
const SAVE_EVERY = Math.max(10, Number(process.env.SAVE_EVERY || "25"));
const RESUME = process.env.RESUME !== "0";
const FORCE_RETRY = process.env.FORCE_RETRY === "1";

function clean(raw) {
  return String(raw || "").replace(/&amp;/g, "&").trim();
}

function normalizeText(raw) {
  return clean(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(raw) {
  return new Set(normalizeText(raw).split(" ").filter((x) => x.length >= 3));
}

function scoreCandidate(record, title) {
  const target = new Set([
    ...tokens(record.title),
    ...tokens(record.brand),
    ...tokens(record.agency),
    ...tokens(String(record.year || "")),
  ]);
  const cand = tokens(title);
  if (!target.size || !cand.size) return 0;
  let overlap = 0;
  for (const t of target) if (cand.has(t)) overlap += 1;
  return overlap / Math.max(4, Math.min(14, target.size));
}

function isLTWM(url) {
  const u = clean(url);
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    return new URL(u).hostname.toLowerCase().includes("lovetheworkmore.com");
  } catch {
    return false;
  }
}

function extractYoutubeId(url) {
  const u = clean(url);
  if (!u) return "";
  let m = u.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (!m) m = u.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (!m) m = u.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}

async function fetchText(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: c.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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

async function searchYouTube(query) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  const html = await fetchText(url);
  if (!html) return [];

  const out = [];
  const seen = new Set();

  const re = /"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,500}?"title":\{"runs":\[\{"text":"([^"]+)/g;
  let m;
  while ((m = re.exec(html)) && out.length < 30) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: m[2] || "" });
  }

  return out;
}

function save(data, progress) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  fs.writeFileSync(PROGRESS_PATH, JSON.stringify(progress, null, 2));
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const targets = data
  .map((r, idx) => ({ r, idx }))
  .filter(({ r }) => !clean(r.outboundUrl) || isLTWM(r.outboundUrl))
  .map(({ idx }) => idx);

let start = 0;
let checked = 0;
let fixed = 0;
let failed = 0;
let ptr = 0;

if (RESUME && fs.existsSync(PROGRESS_PATH)) {
  try {
    const p = JSON.parse(fs.readFileSync(PROGRESS_PATH, "utf8"));
    start = Number(p.nextIndex || 0);
    checked = Number(p.checked || 0);
    fixed = Number(p.fixed || 0);
    failed = Number(p.failed || 0);
  } catch {}
}

if (FORCE_RETRY || start >= targets.length) {
  start = 0;
  checked = 0;
  fixed = 0;
  failed = 0;
}

const end = Math.min(targets.length, start + MAX_ITEMS);
ptr = start;
console.log(`LTWM/empty outbound targets: ${targets.length}. Processing ${start}..${Math.max(start, end - 1)}`);

async function processOne(i) {
  const rec = data[targets[i]];
  checked += 1;

  const existingYid = extractYoutubeId(rec.outboundUrl || "");
  if (existingYid) {
    rec.outboundUrl = `https://www.youtube.com/watch?v=${existingYid}`;
    rec.thumbnailUrl = `https://i.ytimg.com/vi/${existingYid}/hqdefault.jpg`;
    fixed += 1;
    return;
  }

  const query = `${rec.brand || ""} ${rec.title || ""} case study ad`;
  const candidates = await searchYouTube(query);
  if (!candidates.length) {
    failed += 1;
    return;
  }

  candidates.sort((a, b) => scoreCandidate(rec, b.title) - scoreCandidate(rec, a.title));
  const best = candidates[0];
  const score = scoreCandidate(rec, best.title);
  if (!best || score < 0.18) {
    failed += 1;
    return;
  }

  rec.outboundUrl = `https://www.youtube.com/watch?v=${best.id}`;
  rec.thumbnailUrl = `https://i.ytimg.com/vi/${best.id}/hqdefault.jpg`;
  fixed += 1;
}

async function worker() {
  while (true) {
    const i = ptr;
    ptr += 1;
    if (i >= end) return;
    await processOne(i);
    if (checked % SAVE_EVERY === 0) {
      save(data, { updatedAt: new Date().toISOString(), nextIndex: i + 1, checked, fixed, failed });
      console.log(`Progress: checked ${checked}, fixed ${fixed}, failed ${failed}`);
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
save(data, { updatedAt: new Date().toISOString(), nextIndex: end, checked, fixed, failed });
console.log(`Done: checked ${checked}, fixed ${fixed}, failed ${failed}`);
