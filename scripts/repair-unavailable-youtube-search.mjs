import fs from "node:fs";
import path from "node:path";

const DATA_PATH = path.resolve("data/campaigns.json");
const AUDIT_PATH = path.resolve("data/link_audit.json");
const REPORT_PATH = path.resolve("data/repair_unavailable_youtube_search.report.json");

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || "6"));
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

function normalizeFoundUrl(raw) {
  if (!raw) return "";
  let u = raw.replace(/&amp;/g, "&");
  if (u.startsWith("//")) u = `https:${u}`;
  try {
    const parsed = new URL(u);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return parsed.toString();
  } catch {
    return "";
  }
}

function isYoutubeUrl(u) {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
    return h === "youtube.com" || h === "youtu.be" || h.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

async function fetchText(url, maxLen = 350000) {
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

function extractMetaDescription(html) {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"]+)/i) ||
    html.match(/<meta[^>]+content=["']([^"]+)[^>]+name=["']description["']/i);
  return m?.[1] ? clean(m[1]) : "";
}

async function searchBing(query) {
  const html = await fetchText(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`);
  if (!html) return [];
  const out = [];
  const rx = /<li[^>]*class=(?:"|')?b_algo(?:"|')?[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) && out.length < 12) {
    const u = normalizeFoundUrl(m[1]);
    const title = clean((m[2] || "").replace(/<[^>]+>/g, " "));
    if (u) out.push({ url: u, title });
  }
  return out;
}

async function searchDuck(query) {
  const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  if (!html) return [];
  const out = [];
  const rx = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) && out.length < 12) {
    const u = normalizeFoundUrl(m[1]);
    const title = clean((m[2] || "").replace(/<[^>]+>/g, " "));
    if (u) out.push({ url: u, title });
  }
  return out;
}

function scoreCandidate(record, title, description) {
  const wanted = new Set([
    ...tokens(record.title),
    ...tokens(record.brand),
    ...tokens(record.agency),
    ...tokens(String(record.year || "")),
  ]);
  const got = new Set([...tokens(title), ...tokens(description)]);
  if (!wanted.size || !got.size) return 0;
  let overlap = 0;
  for (const t of wanted) if (got.has(t)) overlap += 1;
  let score = overlap / Math.max(4, Math.min(16, wanted.size));
  const blob = `${normalize(title)} ${normalize(description)}`;
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

console.log(`Unavailable YouTube targets (search): ${targets.length}`);

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
      `site:youtube.com ${rec.title || ""} ${rec.brand || ""} ${rec.year || ""} ad`,
      `site:youtube.com ${rec.brand || ""} ${rec.title || ""} campaign`,
      `site:youtube.com ${rec.title || ""} commercial`,
    ];

    let best = null;
    let hadCandidates = false;

    for (const q of queries) {
      // eslint-disable-next-line no-await-in-loop
      const [bing, duck] = await Promise.all([searchBing(q), searchDuck(q)]);
      searched += 1;
      const merged = [...bing, ...duck].filter((x) => isYoutubeUrl(x.url));
      const dedup = [];
      const seen = new Set();
      for (const x of merged) {
        const id = extractYoutubeId(x.url);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        dedup.push({ ...x, id });
      }
      if (!dedup.length) continue;
      hadCandidates = true;

      for (const cand of dedup.slice(0, 8)) {
        // eslint-disable-next-line no-await-in-loop
        const ok = await youtubeOembedOk(cand.id);
        if (!ok) continue;
        // eslint-disable-next-line no-await-in-loop
        const html = await fetchText(`https://www.youtube.com/watch?v=${cand.id}`, 240000);
        const desc = extractMetaDescription(html);
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
