import fs from "node:fs";
import path from "node:path";
import ytsrMod from "ytsr";

const ytsr = ytsrMod?.default || ytsrMod;

const DATA_PATH = path.resolve("data/campaigns.json");
const AUDIT_PATH = path.resolve("data/link_audit.json");
const REPORT_PATH = path.resolve("data/repair_unavailable_youtube_ytsr.report.json");

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || "5"));
const MAX_ITEMS = Math.max(1, Number(process.env.MAX_ITEMS || "300"));
const REQUEST_TIMEOUT_MS = Math.max(4000, Number(process.env.REQUEST_TIMEOUT_MS || "12000"));
const MIN_SCORE = Number(process.env.MIN_SCORE || "0.20");

function clean(raw) {
  return String(raw || "").replace(/&amp;/g, "&").trim();
}

function normalize(raw) {
  return clean(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(raw) {
  return new Set(normalize(raw).split(" ").filter((x) => x.length >= 3));
}

function extractYoutubeId(raw) {
  const s = clean(raw);
  if (!s) return "";
  let m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (!m) m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (!m) m = s.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/);
  if (!m) m = s.match(/\/embed\/([A-Za-z0-9_-]{11})/);
  return m ? m[1] : "";
}

function extractMetaDescription(html) {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"]+)/i) ||
    html.match(/<meta[^>]+content=["']([^"]+)[^>]+name=["']description["']/i);
  return m?.[1] ? clean(m[1]) : "";
}

async function fetchText(url, maxLen = 280000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: c.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    if (!res.ok) return "";
    const txt = await res.text();
    return txt.slice(0, maxLen);
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

async function youtubeOembedOk(videoId) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
  try {
    const u = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const res = await fetch(u, { method: "GET", redirect: "follow", signal: c.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function searchWithYtsr(query) {
  const origErr = console.error;
  const origLog = console.log;
  try {
    // ytsr 3.8.4 emits noisy parser warnings for newer YouTube modules.
    // Suppress those logs but still use any parsed items returned.
    console.error = () => {};
    console.log = () => {};
    const r = await ytsr(query, { limit: 15 });
    return (r.items || [])
      .filter((it) => it.type === "video" && it.id && it.url)
      .slice(0, 10)
      .map((it) => ({
        id: it.id,
        url: it.url,
        title: clean(it.title || ""),
        snippet: clean(Array.isArray(it.description) ? it.description.join(" ") : it.description || ""),
      }));
  } catch {
    return [];
  } finally {
    console.error = origErr;
    console.log = origLog;
  }
}

function scoreCandidate(record, title, snippet, watchDesc) {
  const wanted = new Set([
    ...tokens(record.title),
    ...tokens(record.brand),
    ...tokens(record.agency),
    ...tokens(String(record.year || "")),
  ]);
  const got = new Set([...tokens(title), ...tokens(snippet), ...tokens(watchDesc)]);
  if (!wanted.size || !got.size) return 0;
  let overlap = 0;
  for (const t of wanted) if (got.has(t)) overlap += 1;

  let score = overlap / Math.max(4, Math.min(16, wanted.size));
  const blob = `${normalize(title)} ${normalize(snippet)} ${normalize(watchDesc)}`;
  if (record.year && blob.includes(String(record.year))) score += 0.04;
  if (normalize(record.brand) && blob.includes(normalize(record.brand))) score += 0.06;
  return score;
}

async function runPool(items, worker, n) {
  let i = 0;
  const runners = Array.from({ length: n }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      await worker(items[idx], idx);
      if ((idx + 1) % 20 === 0) console.log(`Processed ${idx + 1}/${items.length}`);
    }
  });
  await Promise.all(runners);
}

if (!fs.existsSync(DATA_PATH) || !fs.existsSync(AUDIT_PATH)) {
  console.error("Missing campaigns or link_audit");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, "utf8"));
const byId = new Map(data.map((r) => [r.id, r]));

const targets = (audit.rows || [])
  .filter((r) => r.class === "unavailable" && String(r.note || "").startsWith("youtube_unavailable_"))
  .slice(0, MAX_ITEMS)
  .map((r) => byId.get(r.id))
  .filter(Boolean);

console.log(`Unavailable YouTube targets (ytsr): ${targets.length}`);

let searched = 0;
let replaced = 0;
let noCandidates = 0;
let lowScore = 0;
let unavailable = 0;
const changed = [];

await runPool(
  targets,
  async (rec) => {
    const oldId = extractYoutubeId(rec.outboundUrl || rec.sourceUrl || rec.thumbnailUrl);
    const queries = [
      `${rec.title || ""} ${rec.brand || ""} ${rec.year || ""} ad`,
      `${rec.brand || ""} ${rec.title || ""} campaign`,
      `${rec.title || ""} commercial`,
    ];

    let best = null;
    let hadCandidates = false;

    for (const q of queries) {
      // eslint-disable-next-line no-await-in-loop
      const list = await searchWithYtsr(q);
      searched += 1;
      if (!list.length) continue;
      hadCandidates = true;

      for (const cand of list) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await youtubeOembedOk(cand.id);
        if (!ok) continue;
        // eslint-disable-next-line no-await-in-loop
        const html = await fetchText(`https://www.youtube.com/watch?v=${cand.id}`, 240000);
        const watchDesc = extractMetaDescription(html);
        const score = scoreCandidate(rec, cand.title, cand.snippet, watchDesc);
        if (!best || score > best.score) {
          best = { ...cand, watchDesc, score };
        }
      }
      if (best && best.score >= MIN_SCORE) break;
    }

    if (!hadCandidates) {
      noCandidates += 1;
      return;
    }
    if (!best) {
      unavailable += 1;
      return;
    }
    if (best.score < MIN_SCORE) {
      lowScore += 1;
      return;
    }

    const nextUrl = `https://www.youtube.com/watch?v=${best.id}`;
    if (rec.outboundUrl !== nextUrl) {
      rec.outboundUrl = nextUrl;
      rec.thumbnailUrl = `https://i.ytimg.com/vi/${best.id}/maxresdefault.jpg`;
      replaced += 1;
      changed.push({
        id: rec.id,
        title: rec.title,
        brand: rec.brand,
        year: rec.year,
        oldVideoId: oldId,
        newVideoId: best.id,
        matchScore: Number(best.score.toFixed(3)),
        matchedTitle: best.title,
        matchedSnippet: best.snippet?.slice(0, 180) || "",
        matchedDescription: best.watchDesc?.slice(0, 220) || "",
      });
    }
  },
  CONCURRENCY
);

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
fs.writeFileSync(
  REPORT_PATH,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      targets: targets.length,
      searched,
      replaced,
      noCandidates,
      lowScore,
      unavailable,
      minScore: MIN_SCORE,
      changed,
    },
    null,
    2
  )
);

console.log(JSON.stringify({ targets: targets.length, searched, replaced, noCandidates, lowScore, unavailable }, null, 2));
console.log(`Wrote ${REPORT_PATH}`);
