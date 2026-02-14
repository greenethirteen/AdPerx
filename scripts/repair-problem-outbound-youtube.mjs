import fs from "node:fs";
import path from "node:path";

const DATA_PATH = path.resolve("data/campaigns.json");
const REPORT_PATH = path.resolve("data/repair_problem_outbound_youtube.report.json");

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || "8"));
const MAX_ITEMS = Math.max(1, Number(process.env.MAX_ITEMS || "2000"));
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.REQUEST_TIMEOUT_MS || "12000"));
const MIN_SCORE = Number(process.env.MIN_SCORE || "0.22");

const BAD_HOSTS = (process.env.BAD_HOSTS ||
  "adeevee.com,adforum.com,es.adforum.com,cargocollective.com,dangreener.com,21gramsworld.com,drive.google.com,portal-assets.imgix.net,adsspot.me,storage.googleapis.com")
  .split(",")
  .map((x) => x.trim().toLowerCase())
  .filter(Boolean);

function clean(raw) {
  return String(raw || "").replace(/&amp;/g, "&").trim();
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalize(raw) {
  return clean(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\\s]/g, " ")
    .replace(/\\s+/g, " ")
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
  if (!m) m = s.match(/\/vi\/([A-Za-z0-9_-]{11})\//);
  return m ? m[1] : "";
}

function scoreCandidate(row, title) {
  const wanted = new Set([
    ...tokens(row.title),
    ...tokens(row.brand),
    ...tokens(row.agency),
    ...tokens(String(row.year || "")),
  ]);
  const got = tokens(title);
  if (!wanted.size || !got.size) return 0;
  let overlap = 0;
  for (const t of wanted) if (got.has(t)) overlap += 1;
  return overlap / Math.max(4, Math.min(16, wanted.size));
}

async function fetchText(url) {
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
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(t);
  }
}

async function searchYouTube(query) {
  const html = await fetchText(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
  );
  if (!html) return [];

  const out = [];
  const seen = new Set();
  const re =
    /"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,500}?"title":\{"runs":\[\{"text":"([^"]+)/g;
  let m;
  while ((m = re.exec(html)) && out.length < 40) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ id: m[1], title: m[2] || "" });
  }
  return out;
}

async function youtubeAvailable(id) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), REQUEST_TIMEOUT_MS);
  try {
    const u = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`;
    const res = await fetch(u, { method: "GET", redirect: "follow", signal: c.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function runPool(items, worker, concurrency) {
  let idx = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      await worker(items[i], i);
      if ((i + 1) % 25 === 0) console.log(`Processed ${i + 1}/${items.length}`);
    }
  });
  await Promise.all(runners);
}

const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
const targets = data
  .filter((r) => {
    const h = hostOf(r.outboundUrl || "");
    return h && BAD_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
  })
  .slice(0, MAX_ITEMS);

console.log(`Problem-host targets: ${targets.length}`);

let searched = 0;
let replaced = 0;
let noCandidates = 0;
let lowScore = 0;
let unavailable = 0;
const changed = [];

await runPool(
  targets,
  async (row) => {
    const existingId =
      extractYoutubeId(row.outboundUrl) ||
      extractYoutubeId(row.sourceUrl) ||
      extractYoutubeId(row.thumbnailUrl);
    if (existingId && (await youtubeAvailable(existingId))) {
      const nextUrl = `https://www.youtube.com/watch?v=${existingId}`;
      const nextThumb = `https://i.ytimg.com/vi/${existingId}/maxresdefault.jpg`;
      if (row.outboundUrl !== nextUrl || row.thumbnailUrl !== nextThumb) {
        changed.push({
          id: row.id,
          title: row.title,
          brand: row.brand,
          oldUrl: row.outboundUrl,
          newUrl: nextUrl,
          score: 1,
        });
        row.outboundUrl = nextUrl;
        row.thumbnailUrl = nextThumb;
        replaced += 1;
      }
      return;
    }

    const queries = [
      `${row.title || ""} ${row.brand || ""} ${row.year || ""} ad case study`,
      `${row.brand || ""} ${row.title || ""} campaign`,
      `${row.title || ""} ${row.year || ""} commercial`,
      `${row.brand || ""} ${row.year || ""} case study`,
      `${row.title || ""} ad`,
    ];

    let best = null;
    let anyCandidates = false;
    for (const q of queries) {
      searched += 1;
      const results = await searchYouTube(q);
      if (!results.length) continue;
      anyCandidates = true;
      const scored = results
        .map((r) => ({ ...r, score: scoreCandidate(row, r.title) }))
        .sort((a, b) => b.score - a.score);
      if (!best || (scored[0] && scored[0].score > best.score)) best = scored[0];
      if (best && best.score >= MIN_SCORE) break;
    }

    if (!anyCandidates || !best) {
      noCandidates += 1;
      return;
    }
    if (best.score < MIN_SCORE) {
      lowScore += 1;
      return;
    }
    const ok = await youtubeAvailable(best.id);
    if (!ok) {
      unavailable += 1;
      return;
    }

    const nextUrl = `https://www.youtube.com/watch?v=${best.id}`;
    const nextThumb = `https://i.ytimg.com/vi/${best.id}/maxresdefault.jpg`;
    if (row.outboundUrl !== nextUrl || row.thumbnailUrl !== nextThumb) {
      changed.push({
        id: row.id,
        title: row.title,
        brand: row.brand,
        oldUrl: row.outboundUrl,
        newUrl: nextUrl,
        score: Number(best.score.toFixed(3)),
      });
      row.outboundUrl = nextUrl;
      row.thumbnailUrl = nextThumb;
      replaced += 1;
    }
  },
  CONCURRENCY
);

fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
const report = {
  generatedAt: new Date().toISOString(),
  targets: targets.length,
  searched,
  replaced,
  noCandidates,
  lowScore,
  unavailable,
  minScore: MIN_SCORE,
  changed,
};
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

console.log("Done", { searched, replaced, noCandidates, lowScore, unavailable });
console.log(`Wrote ${REPORT_PATH}`);
