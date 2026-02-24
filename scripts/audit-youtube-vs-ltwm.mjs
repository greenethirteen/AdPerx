import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

const ROOT = process.cwd();
const CAMPAIGNS_PATH = path.join(ROOT, "data", "campaigns.json");
const AUDIT_PATH = path.join(ROOT, "data", "link_audit.json");
const OUT_CSV = path.join(ROOT, "data", "suspect_bad_youtube_ltwm.csv");
const OUT_JSON = path.join(ROOT, "data", "suspect_bad_youtube_ltwm.json");

const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || "12"));
const TIMEOUT_MS = Math.max(4000, Number(process.env.REQUEST_TIMEOUT_MS || "12000"));
const MAX_BYTES = Math.max(120_000, Number(process.env.MAX_BYTES || "400000"));
const SUSPECT_THRESHOLD = Number(process.env.SUSPECT_THRESHOLD || "0.18");

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

function parseYoutubeId(url) {
  try {
    const u = new URL(url);
    const h = u.hostname.replace(/^www\./, "").toLowerCase();
    if (h === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
    }
    if (h.endsWith("youtube.com")) {
      const v = u.searchParams.get("v") || "";
      if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const p = u.pathname.split("/").filter(Boolean);
      if ((p[0] === "embed" || p[0] === "shorts") && /^[A-Za-z0-9_-]{11}$/.test(p[1] || "")) return p[1];
    }
  } catch {}
  return "";
}

function scoreOverlap(wantSet, gotText) {
  const got = tokens(gotText);
  if (!wantSet.size || !got.size) return 0;
  let overlap = 0;
  for (const t of wantSet) if (got.has(t)) overlap += 1;
  return overlap / Math.max(5, Math.min(16, wantSet.size || 5));
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
        let clipped = false;
        let finished = false;
        const finish = () => {
          if (finished) return;
          finished = true;
          const raw = Buffer.concat(chunks);
          const decoded = decodeBody(raw, res.headers["content-encoding"]);
          done({ status, body: decoded.toString("utf8"), url });
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
        res.on("error", () => done({ status: 0, body: "", url }));
      }
    );

    req.setTimeout(TIMEOUT_MS, () => req.destroy());
    req.on("error", () => done({ status: 0, body: "", url }));
    req.end();
  });
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

if (!fs.existsSync(CAMPAIGNS_PATH) || !fs.existsSync(AUDIT_PATH)) {
  console.error("Missing data/campaigns.json or data/link_audit.json");
  process.exit(1);
}

const campaigns = JSON.parse(fs.readFileSync(CAMPAIGNS_PATH, "utf8"));
const linkAudit = JSON.parse(fs.readFileSync(AUDIT_PATH, "utf8"));
const byIdAudit = new Map((linkAudit.rows || []).map((r) => [r.id, r]));

const targets = campaigns.filter((c) => {
  const out = String(c.outboundUrl || "");
  const src = String(c.sourceUrl || "");
  return parseYoutubeId(out) && hostOf(src).includes("lovetheworkmore.com");
});

console.log(`Campaigns total: ${campaigns.length}`);
console.log(`Targets (YouTube + LTWM source): ${targets.length}`);

const uniqueSourceUrls = [...new Set(targets.map((t) => t.sourceUrl).filter(Boolean))];
console.log(`Unique LTWM source pages to fetch: ${uniqueSourceUrls.length}`);

const pageResults = await runPool(
  uniqueSourceUrls,
  async (url) => {
    const res = await requestUrl(url);
    const text = normalize((res.body || "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
    return { url, ok: res.status >= 200 && res.status < 400, text };
  },
  CONCURRENCY
);
const pageTextByUrl = new Map(pageResults.map((r) => [r.url, r]));

const rows = [];
for (const c of targets) {
  const a = byIdAudit.get(c.id) || {};
  const ytTitle = String(a.ytTitle || "");
  const ytAuthor = String(a.ytAuthor || "");
  const ytClass = String(a.class || "");
  const ytNote = String(a.note || "");

  const keyTokens = new Set([
    ...tokens(c.title || ""),
    ...tokens(c.brand || ""),
    ...tokens(c.agency || ""),
    ...tokens(String(c.year || "")),
  ]);
  const titleBrandTokens = new Set([...tokens(c.title || ""), ...tokens(c.brand || "")]);

  const ytScore = scoreOverlap(keyTokens, `${ytTitle} ${ytAuthor}`);
  const pageRec = pageTextByUrl.get(c.sourceUrl);
  const ltwmScore = pageRec ? scoreOverlap(titleBrandTokens, pageRec.text) : 0;

  let reason = "";
  if (ytClass === "unavailable" || ytNote.startsWith("youtube_unavailable_")) reason = "youtube_unavailable";
  else if (!ytTitle) reason = "missing_youtube_meta";
  else if (ytScore < SUSPECT_THRESHOLD && ltwmScore >= 0.2) reason = "low_title_match_vs_youtube";
  else if (ytScore < SUSPECT_THRESHOLD && ltwmScore < 0.2) reason = "low_title_match_and_low_ltwm_signal";
  else continue;

  rows.push({
    id: c.id,
    case_name: c.title || "",
    brand: c.brand || "",
    agency: c.agency || "",
    year: c.year || "",
    outbound_url: c.outboundUrl || "",
    source_url: c.sourceUrl || "",
    youtube_title: ytTitle,
    youtube_author: ytAuthor,
    yt_score: Number(ytScore.toFixed(4)),
    ltwm_page_score: Number(ltwmScore.toFixed(4)),
    audit_class: ytClass,
    audit_note: ytNote,
    reason,
  });
}

rows.sort((a, b) => {
  if (a.reason !== b.reason) return a.reason.localeCompare(b.reason);
  return a.yt_score - b.yt_score;
});

const summary = {
  generatedAt: new Date().toISOString(),
  campaigns: campaigns.length,
  targets: targets.length,
  uniqueSourceUrls: uniqueSourceUrls.length,
  suspects: rows.length,
  byReason: rows.reduce((acc, r) => {
    acc[r.reason] = (acc[r.reason] || 0) + 1;
    return acc;
  }, {}),
  threshold: SUSPECT_THRESHOLD,
};

fs.writeFileSync(OUT_JSON, JSON.stringify({ summary, rows }, null, 2));

const header = [
  "id",
  "case_name",
  "brand",
  "agency",
  "year",
  "reason",
  "yt_score",
  "ltwm_page_score",
  "outbound_url",
  "source_url",
  "youtube_title",
  "youtube_author",
  "audit_class",
  "audit_note",
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
      r.reason,
      r.yt_score,
      r.ltwm_page_score,
      r.outbound_url,
      r.source_url,
      r.youtube_title,
      r.youtube_author,
      r.audit_class,
      r.audit_note,
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
