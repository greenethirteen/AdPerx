import fs from "node:fs";
import path from "node:path";

const DATA_PATH = path.resolve("data/campaigns.json");
const AUDIT_PATH = path.resolve("data/link_audit.json");
const REPORT_PATH = path.resolve("data/repair_unavailable_youtube.report.json");

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || "6"));
const MAX_ITEMS = Math.max(1, Number(process.env.MAX_ITEMS || "300"));
const REQUEST_TIMEOUT_MS = Math.max(4000, Number(process.env.REQUEST_TIMEOUT_MS || "12000"));
const MIN_SCORE = Number(process.env.MIN_SCORE || "0.22");

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

async function fetchText(url, maxLen = 400000) {
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

async function searchYoutube(query) {
  const html = await fetchText(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`);
  if (!html) return [];

  const out = [];
  const seen = new Set();
  const re =
    /"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,500}?"title":\{"runs":\[\{"text":"([^"]+)/g;
  let m;
  while ((m = re.exec(html)) && out.length < 35) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: m[2] || "" });
  }
  return out;
}

function extractMetaDescription(html) {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"]+)/i) ||
    html.match(/<meta[^>]+content=["']([^"]+)[^>]+name=["']description["']/i);
  return m?.[1] ? clean(m[1]) : "";
}

function scoreCandidate(record, candidateTitle, candidateDescription) {
  const wanted = new Set([
    ...tokens(record.title),
    ...tokens(record.brand),
    ...tokens(record.agency),
    ...tokens(String(record.year || "")),
  ]);
  const got = new Set([...tokens(candidateTitle), ...tokens(candidateDescription)]);
  if (!wanted.size || !got.size) return 0;
  let overlap = 0;
  for (const t of wanted) if (got.has(t)) overlap += 1;

  let score = overlap / Math.max(4, Math.min(16, wanted.size));
  const blob = `${normalize(candidateTitle)} ${normalize(candidateDescription)}`;
  if (record.year && blob.includes(String(record.year))) score += 0.04;
  if (normalize(record.brand) && blob.includes(normalize(record.brand))) score += 0.06;
  if (normalize(record.title) && blob.includes(normalize(record.title).split(" ").slice(0, 2).join(" "))) score += 0.05;
  return score;
}

async function runPool(items, worker, n) {
  let i = 0;
  const out = [];
  const runners = Array.from({ length: n }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx], idx);
      if ((idx + 1) % 20 === 0) console.log(`Processed ${idx + 1}/${items.length}`);
    }
  });
  await Promise.all(runners);
  return out;
}

if (!fs.existsSync(DATA_PATH) || !fs.existsSync(AUDIT_PATH)) {
  console.error("Missing campaigns or link_audit file");
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

console.log(`Unavailable YouTube targets: ${targets.length}`);

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
      `${rec.title || ""} ${rec.brand || ""} ${rec.year || ""} ad case study`,
      `${rec.brand || ""} ${rec.title || ""} campaign`,
      `${rec.title || ""} ${rec.year || ""} commercial`,
      `${rec.brand || ""} ${rec.year || ""} ad`,
    ];

    let best = null;
    let hadCandidates = false;

    for (const q of queries) {
      // eslint-disable-next-line no-await-in-loop
      const list = await searchYoutube(q);
      searched += 1;
      if (!list.length) continue;
      hadCandidates = true;

      for (const cand of list.slice(0, 8)) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await youtubeOembedOk(cand.id);
        if (!ok) continue;
        // eslint-disable-next-line no-await-in-loop
        const watchHtml = await fetchText(`https://www.youtube.com/watch?v=${cand.id}`, 300000);
        const desc = extractMetaDescription(watchHtml);
        const score = scoreCandidate(rec, cand.title || "", desc || "");
        if (!best || score > best.score) {
          best = { id: cand.id, title: cand.title || "", description: desc, score };
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
    const nextThumb = `https://i.ytimg.com/vi/${best.id}/maxresdefault.jpg`;
    if (rec.outboundUrl !== nextUrl) {
      rec.outboundUrl = nextUrl;
      rec.thumbnailUrl = nextThumb;
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
        matchedDescription: best.description?.slice(0, 220) || "",
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
