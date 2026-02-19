import fs from "node:fs";
import path from "node:path";
const ROOT = process.cwd();
const BROKEN_CSV = path.join(ROOT, "data", "broken_case_agency_year.csv");
const CAMPAIGNS_JSON = path.join(ROOT, "data", "campaigns.json");
const OUT_JSON = path.join(ROOT, "data", "broken_case_youtube_candidates.json");
const OUT_CSV = path.join(ROOT, "data", "broken_case_youtube_candidates.csv");

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || "4"));
const MAX_CASES = Math.max(1, Number(process.env.MAX_CASES || "2000"));
const PER_QUERY_LIMIT = Math.max(5, Number(process.env.PER_QUERY_LIMIT || "12"));
const TOP_N = Math.max(1, Number(process.env.TOP_N || "5"));
const REQUEST_TIMEOUT_MS = Math.max(4000, Number(process.env.REQUEST_TIMEOUT_MS || "12000"));

function normalize(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(s) {
  return new Set(
    normalize(s)
      .split(" ")
      .filter((t) => t.length >= 3)
  );
}

function scoreCandidate(campaign, candidateTitle = "") {
  const wanted = new Set([
    ...tokenSet(campaign.title),
    ...tokenSet(campaign.brand),
    ...tokenSet(campaign.agency),
    ...tokenSet(String(campaign.year || "")),
  ]);
  const got = tokenSet(candidateTitle);
  if (!wanted.size || !got.size) return 0;
  let overlap = 0;
  for (const t of wanted) {
    if (got.has(t)) overlap += 1;
  }
  return overlap / Math.max(4, Math.min(14, wanted.size));
}

function parseBrokenCaseIds(csvText) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  return lines
    .slice(1)
    .map((line) => line.split(",", 1)[0]?.trim())
    .filter(Boolean);
}

function escapeCsvCell(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
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

async function searchYoutube(query) {
  const html = await fetchText(
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
  );
  if (!html) return [];
  const out = [];
  const seen = new Set();
  const rx =
    /"videoId":"([A-Za-z0-9_-]{11})"[\s\S]{0,500}?"title":\{"runs":\[\{"text":"([^\"]+)/g;
  let m;
  while ((m = rx.exec(html)) && out.length < PER_QUERY_LIMIT) {
    const videoId = m[1];
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    out.push({
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: m[2] || "",
      author: "",
      duration: "",
      views: "",
      uploadedAt: "",
    });
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
      if ((idx + 1) % 25 === 0) {
        console.log(`Processed ${idx + 1}/${items.length}`);
      }
    }
  });
  await Promise.all(runners);
  return out;
}

if (!fs.existsSync(BROKEN_CSV) || !fs.existsSync(CAMPAIGNS_JSON)) {
  console.error("Missing required input files.");
  process.exit(1);
}

const brokenIds = parseBrokenCaseIds(fs.readFileSync(BROKEN_CSV, "utf8")).slice(0, MAX_CASES);
const campaigns = JSON.parse(fs.readFileSync(CAMPAIGNS_JSON, "utf8"));
const byId = new Map(campaigns.map((c) => [c.id, c]));

const targets = brokenIds
  .map((id) => byId.get(id))
  .filter(Boolean)
  .map((c) => ({
    id: c.id,
    title: c.title || "",
    brand: c.brand || "",
    agency: c.agency || "",
    year: c.year || "",
    currentOutboundUrl: c.outboundUrl || "",
    currentThumbnailUrl: c.thumbnailUrl || "",
  }));

console.log(`Broken CSV rows: ${brokenIds.length}`);
console.log(`Targets found in campaigns.json: ${targets.length}`);

let failed = 0;
const rows = await runPool(
  targets,
  async (c) => {
    const query = `${c.title} ${c.brand} ${c.year} case study`;
    try {
      const candidates = await searchYoutube(query);
      const scored = candidates
        .map((x) => ({
          ...x,
          score: Number(scoreCandidate(c, x.title).toFixed(4)),
          thumbnailUrl: x.videoId ? `https://i.ytimg.com/vi/${x.videoId}/hqdefault.jpg` : "",
        }))
        .sort((a, b) => b.score - a.score);
      return {
        ...c,
        query,
        candidateCount: scored.length,
        top: scored.slice(0, TOP_N),
      };
    } catch (err) {
      failed += 1;
      return {
        ...c,
        query,
        candidateCount: 0,
        top: [],
        error: String(err?.message || err || "search_failed"),
      };
    }
  },
  CONCURRENCY
);

const summary = {
  generatedAt: new Date().toISOString(),
  inputRows: brokenIds.length,
  targets: targets.length,
  searched: rows.length,
  failed,
  withAtLeastOneCandidate: rows.filter((r) => (r.candidateCount || 0) > 0).length,
  withTopScoreAtLeast0_5: rows.filter((r) => (r.top?.[0]?.score || 0) >= 0.5).length,
  withTopScoreAtLeast0_34: rows.filter((r) => (r.top?.[0]?.score || 0) >= 0.34).length,
};

const outJson = { summary, rows };
fs.writeFileSync(OUT_JSON, JSON.stringify(outJson, null, 2));

const csvHeader = [
  "id",
  "year",
  "brand",
  "title",
  "agency",
  "current_outbound_url",
  "query",
  "best_score",
  "best_video_url",
  "best_video_title",
  "best_thumbnail_url",
];

const csvLines = [csvHeader.join(",")];
for (const r of rows) {
  const best = r.top?.[0] || {};
  csvLines.push(
    [
      r.id,
      r.year,
      r.brand,
      r.title,
      r.agency,
      r.currentOutboundUrl,
      r.query,
      best.score ?? "",
      best.url ?? "",
      best.title ?? "",
      best.thumbnailUrl ?? "",
    ]
      .map(escapeCsvCell)
      .join(",")
  );
}
fs.writeFileSync(OUT_CSV, `${csvLines.join("\n")}\n`);

console.log("Done.");
console.log(`Wrote ${OUT_JSON}`);
console.log(`Wrote ${OUT_CSV}`);
console.log(summary);
