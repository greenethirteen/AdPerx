import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

const ROOT = process.cwd();
const CAMPAIGNS_PATH = path.join(ROOT, "data", "campaigns.json");
const OUT_CSV = path.join(ROOT, "data", "category_backfill_candidates_2000_2005.csv");

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || "12"));
const REQUEST_TIMEOUT_MS = Math.max(4000, Number(process.env.REQUEST_TIMEOUT_MS || "12000"));
const MAX_BYTES = Math.max(100_000, Number(process.env.MAX_BYTES || "240000"));

const CATEGORY_RULES = [
  { re: /\b(print|press|newspaper|magazine|poster|billboard)\b/i, category: "Print", confidence: 0.9 },
  { re: /\b(radio|audio|podcast|sound)\b/i, category: "Radio/Audio", confidence: 0.9 },
  { re: /\b(outdoor|ooh|out-of-home|out of home)\b/i, category: "Other", confidence: 0.75 },
  { re: /\b(direct|direct-marketing|mailer|dm)\b/i, category: "Direct", confidence: 0.85 },
  { re: /\b(digital|interactive|website|web|app|mobile)\b/i, category: "Digital", confidence: 0.85 },
  { re: /\b(design|identity|branding|packaging)\b/i, category: "Design", confidence: 0.85 },
  { re: /\b(pr|public relations)\b/i, category: "PR", confidence: 0.8 },
  { re: /\b(media)\b/i, category: "Media", confidence: 0.75 },
  { re: /\b(film|tv commercial|video|cinema|case study|vimeo|youtube)\b/i, category: "Film", confidence: 0.75 },
];

function normalize(text) {
  return String(text || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
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

function requestUrl(url, { maxBytes = MAX_BYTES, maxRedirects = 5 } = {}) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      resolve({ status: 0, body: "", finalUrl: url });
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
        let clipped = false;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          const raw = Buffer.concat(chunks);
          const decoded = decodeBody(raw, res.headers["content-encoding"]);
          done({ status, body: decoded.toString("utf8"), finalUrl: url });
        };
        res.on("data", (c) => {
          chunks.push(c);
          total += c.length;
          if (total > maxBytes) {
            clipped = true;
            res.destroy();
          }
        });
        res.on("end", finish);
        res.on("close", () => {
          if (clipped) finish();
        });
        res.on("error", () => done({ status: 0, body: "", finalUrl: url }));
      }
    );

    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy());
    req.on("error", () => done({ status: 0, body: "", finalUrl: url }));
    req.end();
  });
}

function extractPageSignals(html) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
  const desc =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    "";
  return normalize(`${title} ${ogTitle} ${desc}`);
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function suggestCategory(textBlob) {
  for (const r of CATEGORY_RULES) {
    if (r.re.test(textBlob)) return { category: r.category, confidence: r.confidence, signal: r.re.source };
  }
  return { category: "Film", confidence: 0.45, signal: "fallback_default" };
}

async function runPool(items, worker, n = 8) {
  let i = 0;
  const out = new Array(items.length);
  const runners = Array.from({ length: n }, async () => {
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

function escapeCsvCell(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

if (!fs.existsSync(CAMPAIGNS_PATH)) {
  console.error("Missing data/campaigns.json");
  process.exit(1);
}

const campaigns = JSON.parse(fs.readFileSync(CAMPAIGNS_PATH, "utf8"));
const targets = campaigns.filter((c) => {
  const y = Number(c.year || 0);
  const noCategory = !String(c.awardCategory || "").trim() && !String(c.categoryBucket || "").trim();
  return noCategory && y >= 2000 && y <= 2005 && String(c.outboundUrl || "").trim();
});

console.log(`Targets (missing category, 2000-2005): ${targets.length}`);

const rows = await runPool(
  targets,
  async (c) => {
    const outUrl = String(c.outboundUrl || "");
    const srcUrl = String(c.sourceUrl || "");
    let blob = normalize(`${outUrl} ${srcUrl}`);

    const host = hostOf(outUrl);
    if (host.includes("youtube.com") || host === "youtu.be" || host.includes("vimeo.com")) {
      blob += " video film";
    } else {
      const res = await requestUrl(outUrl);
      if (res.status >= 200 && res.status < 400 && res.body) {
        blob += " " + extractPageSignals(res.body);
      }
    }

    const s = suggestCategory(blob);
    return {
      id: c.id,
      case_name: c.title || "",
      brand: c.brand || "",
      agency: c.agency || "",
      year: c.year || "",
      current_award_category: c.awardCategory || "",
      current_category_bucket: c.categoryBucket || "",
      suggested_category_bucket: s.category,
      confidence: Number(s.confidence.toFixed(2)),
      evidence_signal: s.signal,
      outbound_url: outUrl,
      source_url: srcUrl,
    };
  },
  CONCURRENCY
);

rows.sort((a, b) => Number(a.year) - Number(b.year) || String(a.case_name).localeCompare(String(b.case_name)));

const header = [
  "id",
  "case_name",
  "brand",
  "agency",
  "year",
  "current_award_category",
  "current_category_bucket",
  "suggested_category_bucket",
  "confidence",
  "evidence_signal",
  "outbound_url",
  "source_url",
];

const csvLines = [header.join(",")];
for (const r of rows) {
  csvLines.push(
    [
      r.id,
      r.case_name,
      r.brand,
      r.agency,
      r.year,
      r.current_award_category,
      r.current_category_bucket,
      r.suggested_category_bucket,
      r.confidence,
      r.evidence_signal,
      r.outbound_url,
      r.source_url,
    ]
      .map(escapeCsvCell)
      .join(",")
  );
}

fs.writeFileSync(OUT_CSV, `${csvLines.join("\n")}\n`);
console.log(`Wrote ${OUT_CSV} (${rows.length} rows)`);
