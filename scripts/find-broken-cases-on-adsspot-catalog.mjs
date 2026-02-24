import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

const ROOT = process.cwd();
const BROKEN_CSV = path.join(ROOT, "data", "broken_case_agency_year.csv");
const CAMPAIGNS_JSON = path.join(ROOT, "data", "campaigns.json");
const OUT_CSV = path.join(ROOT, "data", "broken_cases_adsspot_catalog_matches.csv");
const OUT_JSON = path.join(ROOT, "data", "broken_cases_adsspot_catalog_matches.json");

const PAGE_COUNT = Math.max(1, Number(process.env.PAGE_COUNT || "500"));
const CRAWL_CONCURRENCY = Math.max(1, Number(process.env.CRAWL_CONCURRENCY || "8"));
const VERIFY_CONCURRENCY = Math.max(1, Number(process.env.VERIFY_CONCURRENCY || "6"));
const REQUEST_TIMEOUT_MS = Math.max(4000, Number(process.env.REQUEST_TIMEOUT_MS || "12000"));
const TITLE_MIN_SCORE = Number(process.env.TITLE_MIN_SCORE || "0.45");

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return new Set(normalize(text).split(" ").filter((t) => t.length >= 3));
}

function escapeCsvCell(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function parseBrokenIds(csvText) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  return lines
    .slice(1)
    .map((line) => line.split(",", 1)[0]?.trim())
    .filter(Boolean);
}

function decodeBody(buf, encoding) {
  const enc = String(encoding || "").toLowerCase();
  try {
    if (enc.includes("br")) return zlib.brotliDecompressSync(buf);
    if (enc.includes("gzip")) return zlib.gunzipSync(buf);
    if (enc.includes("deflate")) return zlib.inflateSync(buf);
  } catch {}
  return buf;
}

function requestUrl(url, { maxBytes = 500_000, maxRedirects = 5 } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ status: 0, body: "", url });
      return;
    }
    const lib = parsed.protocol === "https:" ? https : http;
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: "GET",
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          "accept-encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if (location && status >= 300 && status < 400 && maxRedirects > 0) {
          res.resume();
          const next = new URL(location, url).toString();
          requestUrl(next, { maxBytes, maxRedirects: maxRedirects - 1 }).then(done);
          return;
        }
        const chunks = [];
        let total = 0;
        let endedByLimit = false;
        res.on("data", (c) => {
          chunks.push(c);
          total += c.length;
          if (total > maxBytes) {
            endedByLimit = true;
            res.destroy();
          }
        });
        const finish = () => {
          const raw = Buffer.concat(chunks);
          const decoded = decodeBody(raw, res.headers["content-encoding"]);
          done({ status, body: decoded.toString("utf8"), url });
        };
        res.on("end", finish);
        res.on("close", () => {
          if (endedByLimit) finish();
        });
        res.on("error", () => done({ status: 0, body: "", url }));
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy());
    req.on("error", () => done({ status: 0, body: "", url }));
    req.end();
  });
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

function extractAdsFromPage(html) {
  const out = [];
  if (!html) return out;
  const rx = /\\"title\\":\\"([^\\"]+)\\",\\"nanoId\\":\\"([a-z0-9]{12})\\"/g;
  let m;
  while ((m = rx.exec(html))) {
    out.push({
      title: m[1],
      nanoId: m[2],
    });
  }
  return out;
}

function overlapScore(row, text) {
  const want = new Set([
    ...tokens(row.title || ""),
    ...tokens(row.brand || ""),
    ...tokens(row.agency || ""),
    ...tokens(String(row.year || "")),
  ]);
  const got = tokens(text || "");
  let overlap = 0;
  for (const t of want) if (got.has(t)) overlap += 1;
  return overlap / Math.max(5, Math.min(16, want.size || 5));
}

function titleScore(rowTitle, candidateTitle) {
  const a = tokens(rowTitle || "");
  const b = tokens(candidateTitle || "");
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return inter / Math.max(1, union);
}

function canonicalFromHtml(html) {
  if (!html) return "";
  return html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] || "";
}

function ogDescriptionFromHtml(html) {
  if (!html) return "";
  return html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
}

if (!fs.existsSync(BROKEN_CSV) || !fs.existsSync(CAMPAIGNS_JSON)) {
  console.error("Missing required input files.");
  process.exit(1);
}

const brokenIds = parseBrokenIds(fs.readFileSync(BROKEN_CSV, "utf8"));
const campaigns = JSON.parse(fs.readFileSync(CAMPAIGNS_JSON, "utf8"));
const byId = new Map(campaigns.map((c) => [c.id, c]));
const rows = brokenIds
  .map((id) => byId.get(id))
  .filter(Boolean)
  .map((c) => ({
    id: c.id,
    year: c.year || "",
    brand: c.brand || "",
    title: c.title || "",
    agency: c.agency || "",
    currentUrl: c.outboundUrl || "",
  }));

console.log(`Broken rows in CSV: ${brokenIds.length}`);
console.log(`Rows found in campaigns.json: ${rows.length}`);
console.log(`Crawling AdsSpot catalog pages: ${PAGE_COUNT}`);

const pages = Array.from({ length: PAGE_COUNT }, (_, i) => i + 1);
const pageResults = await runPool(
  pages,
  async (page) => {
    const url = `https://adsspot.me/media?page=${page}`;
    const res = await requestUrl(url, { maxBytes: 900_000 });
    if (!(res.status >= 200 && res.status < 400)) return [];
    return extractAdsFromPage(res.body || "");
  },
  CRAWL_CONCURRENCY
);

const adMap = new Map();
for (const list of pageResults) {
  for (const ad of list || []) {
    if (!adMap.has(ad.nanoId)) adMap.set(ad.nanoId, ad);
  }
}
const catalog = [...adMap.values()];
console.log(`Catalog entries extracted: ${catalog.length}`);

const prelim = rows.map((row) => {
  let best = null;
  for (const ad of catalog) {
    const s = titleScore(row.title, ad.title);
    if (!best || s > best.titleScore) best = { ...ad, titleScore: s };
  }
  return {
    ...row,
    bestTitleCandidate: best,
  };
});

const toVerify = prelim.filter((r) => (r.bestTitleCandidate?.titleScore || 0) >= TITLE_MIN_SCORE);
console.log(`Rows above title threshold ${TITLE_MIN_SCORE}: ${toVerify.length}`);

const verifiedList = await runPool(
  toVerify,
  async (row) => {
    const nanoId = row.bestTitleCandidate.nanoId;
    const rough = `https://adsspot.me/media/tv-commercials/x-${nanoId}`;
    const res = await requestUrl(rough, { maxBytes: 450_000 });
    const html = res.body || "";
    const canonical = canonicalFromHtml(html) || rough;
    const ogd = ogDescriptionFromHtml(html);
    const metaScore = overlapScore(row, `${row.bestTitleCandidate.title} ${ogd}`);
    return {
      id: row.id,
      candidateTitle: row.bestTitleCandidate.title,
      candidateNanoId: nanoId,
      candidateTitleScore: row.bestTitleCandidate.titleScore,
      canonicalUrl: canonical,
      metaScore,
      totalScore: Number((row.bestTitleCandidate.titleScore * 0.7 + metaScore * 0.3).toFixed(4)),
    };
  },
  VERIFY_CONCURRENCY
);

const verifiedById = new Map(verifiedList.map((x) => [x.id, x]));
const merged = prelim.map((r) => {
  const v = verifiedById.get(r.id);
  return {
    ...r,
    verified: v || null,
  };
});

const summary = {
  generatedAt: new Date().toISOString(),
  brokenRowsInCsv: brokenIds.length,
  searchedRows: rows.length,
  pageCount: PAGE_COUNT,
  catalogEntries: catalog.length,
  titleThreshold: TITLE_MIN_SCORE,
  aboveTitleThreshold: toVerify.length,
  verifiedCount: verifiedList.length,
  withFinalMatch: merged.filter((r) => (r.verified?.totalScore || 0) >= 0.42).length,
};

fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, rows: merged }, null, 2));

const csvHeader = [
  "id",
  "year",
  "brand",
  "title",
  "agency",
  "current_url",
  "best_adsspot_url",
  "match_title",
  "title_score",
  "meta_score",
  "total_score",
];
const csvLines = [csvHeader.join(",")];
for (const r of merged) {
  const v = r.verified;
  csvLines.push(
    [
      r.id,
      r.year,
      r.brand,
      r.title,
      r.agency,
      r.currentUrl,
      v?.canonicalUrl || "",
      v?.candidateTitle || "",
      v?.candidateTitleScore ?? "",
      v?.metaScore ?? "",
      v?.totalScore ?? "",
    ]
      .map(escapeCsvCell)
      .join(",")
  );
}
fs.writeFileSync(OUT_CSV, `${csvLines.join("\n")}\n`);

console.log("Done.");
console.log(`Wrote ${OUT_CSV}`);
console.log(`Wrote ${OUT_JSON}`);
console.log(summary);
