import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

const ROOT = process.cwd();
const BROKEN_CSV = path.join(ROOT, "data", "broken_case_agency_year.csv");
const CAMPAIGNS_JSON = path.join(ROOT, "data", "campaigns.json");
const OUT_CSV = path.join(ROOT, "data", "broken_cases_adsspot_candidates.csv");
const OUT_JSON = path.join(ROOT, "data", "broken_cases_adsspot_candidates.json");

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || "5"));
const MAX_CASES = Math.max(1, Number(process.env.MAX_CASES || "2000"));
const REQUEST_TIMEOUT_MS = Math.max(4000, Number(process.env.REQUEST_TIMEOUT_MS || "12000"));
const TOP_N = Math.max(1, Number(process.env.TOP_N || "3"));

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

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
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

function requestUrl(url, { maxBytes = 350_000, maxRedirects = 5 } = {}) {
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

async function searchDuck(query) {
  const res = await requestUrl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const html = res.body || "";
  const out = [];
  const rx = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) && out.length < 20) {
    const url = normalizeFoundUrl(m[1] || "");
    const title = String(m[2] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (url) out.push({ url, title, source: "duck" });
  }
  return out;
}

async function searchBing(query) {
  const res = await requestUrl(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`);
  const html = res.body || "";
  const out = [];
  const rx = /<li[^>]*class=(?:"|')?b_algo(?:"|')?[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) && out.length < 20) {
    const url = normalizeFoundUrl(m[1] || "");
    const title = String(m[2] || "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (url) out.push({ url, title, source: "bing" });
  }
  return out;
}

function adsspotSlugMatches(row, url) {
  if (hostOf(url) !== "adsspot.me") return false;
  let pathText = "";
  try {
    pathText = decodeURIComponent(new URL(url).pathname)
      .replace(/[\/_-]+/g, " ")
      .toLowerCase();
  } catch {
    return false;
  }
  if (!pathText.includes("/media".replace("/", " "))) return false;
  const keys = [...tokens(row.title || ""), ...tokens(row.brand || "")]
    .filter((t) => t.length >= 4)
    .slice(0, 12);
  if (!keys.length) return true;
  return keys.some((k) => pathText.includes(k));
}

function score(row, candidate) {
  const want = new Set([
    ...tokens(row.title || ""),
    ...tokens(row.brand || ""),
    ...tokens(row.agency || ""),
    ...tokens(String(row.year || "")),
  ]);
  const got = tokens(`${candidate.title || ""} ${candidate.url || ""}`);
  let overlap = 0;
  for (const t of want) if (got.has(t)) overlap += 1;
  let s = overlap / Math.max(5, Math.min(14, want.size || 5));
  if (adsspotSlugMatches(row, candidate.url)) s += 0.3;
  if (String(candidate.url || "").toLowerCase().includes(String(row.year || ""))) s += 0.03;
  return Number(s.toFixed(4));
}

function dedupe(items) {
  const map = new Map();
  for (const x of items) {
    const url = normalizeFoundUrl(x.url || "");
    if (!url) continue;
    const prev = map.get(url);
    if (!prev || String(x.title || "").length > String(prev.title || "").length) {
      map.set(url, { ...x, url });
    }
  }
  return [...map.values()];
}

function parseBrokenIds(csvText) {
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

async function runPool(items, worker, concurrency) {
  let i = 0;
  const out = [];
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      out[idx] = await worker(items[idx], idx);
      if ((idx + 1) % 20 === 0) {
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

const brokenIds = parseBrokenIds(fs.readFileSync(BROKEN_CSV, "utf8")).slice(0, MAX_CASES);
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

let withCandidates = 0;
const results = await runPool(
  rows,
  async (row) => {
    const query = `${row.title} ${row.brand} ${row.year} site:adsspot.me/media`;
    const [duck, bing] = await Promise.all([searchDuck(query), searchBing(query)]);
    let candidates = dedupe([...duck, ...bing]).filter((x) => hostOf(x.url) === "adsspot.me");
    candidates = candidates.map((c) => ({ ...c, score: score(row, c) })).sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, TOP_N);
    if (top.length) withCandidates += 1;
    return {
      ...row,
      query,
      candidateCount: candidates.length,
      top,
    };
  },
  CONCURRENCY
);

const summary = {
  generatedAt: new Date().toISOString(),
  totalBrokenIds: brokenIds.length,
  searchedRows: rows.length,
  withCandidates,
  withoutCandidates: rows.length - withCandidates,
};

fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, rows: results }, null, 2));

const csvHeader = [
  "id",
  "year",
  "brand",
  "title",
  "agency",
  "current_url",
  "query",
  "best_adsspot_url",
  "best_score",
  "candidate_2",
  "candidate_3",
  "candidate_count",
];

const csvLines = [csvHeader.join(",")];
for (const r of results) {
  const c1 = r.top?.[0]?.url || "";
  const s1 = r.top?.[0]?.score ?? "";
  const c2 = r.top?.[1]?.url || "";
  const c3 = r.top?.[2]?.url || "";
  csvLines.push(
    [
      r.id,
      r.year,
      r.brand,
      r.title,
      r.agency,
      r.currentUrl,
      r.query,
      c1,
      s1,
      c2,
      c3,
      r.candidateCount ?? 0,
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
