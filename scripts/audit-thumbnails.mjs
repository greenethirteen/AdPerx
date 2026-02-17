import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const campaignsPath = path.join(root, "data", "campaigns.json");
const outPath = path.join(root, "data", "thumbnail_audit.json");

const CONCURRENCY = Number(process.env.CONCURRENCY || "20");
const TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || "9000");

const KNOWN_PLACEHOLDERS = [
  "thumbnail-with-correct-ratio-scaled.jpg",
  "CLIOS-Vertical-BlackWhite.png",
  "loadingAnim.gif",
  "question-invalid.png"
];

function normalizeUrl(raw) {
  if (!raw || typeof raw !== "string") return "";
  const url = raw.trim().replace(/&amp;/g, "&");
  if (!url) return "";
  try {
    return new URL(url).toString();
  } catch {
    return "";
  }
}

function normalizeHost(raw) {
  try {
    return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function hasPlaceholderHint(url) {
  const lower = url.toLowerCase();
  return KNOWN_PLACEHOLDERS.some((token) => lower.includes(token.toLowerCase()));
}

async function fetchWithTimeout(url, method = "HEAD") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "AdPerxThumbnailAudit/1.0",
        accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
      }
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function auditThumbnail(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return { status: 0, finalUrl: "", class: "invalid_url", note: "parse_failed" };

  if (hasPlaceholderHint(normalized)) {
    return { status: 200, finalUrl: normalized, class: "likely_incorrect", note: "known_placeholder_asset" };
  }

  let res = await fetchWithTimeout(normalized, "HEAD");
  if (!res || res.status === 405 || res.status === 403 || res.status >= 400) {
    res = await fetchWithTimeout(normalized, "GET");
  }

  if (!res) return { status: 0, finalUrl: normalized, class: "dead", note: "network_error" };

  const status = res.status || 0;
  const finalUrl = res.url || normalized;
  const ctype = String(res.headers.get("content-type") || "").toLowerCase();

  if (status >= 400) return { status, finalUrl, class: "dead", note: "http_error" };
  if (!ctype.startsWith("image/")) return { status, finalUrl, class: "likely_incorrect", note: `non_image_content_type_${ctype || "unknown"}` };

  return { status, finalUrl, class: "ok", note: "" };
}

async function runPool(items, worker, concurrency = 10) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: concurrency }, async () => {
    while (true) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) break;
      out[i] = await worker(items[i], i);
      if ((i + 1) % 200 === 0) console.log(`Audited ${i + 1}/${items.length}`);
    }
  });
  await Promise.all(runners);
  return out;
}

if (!fs.existsSync(campaignsPath)) {
  console.error("Missing data/campaigns.json");
  process.exit(1);
}

const campaigns = JSON.parse(fs.readFileSync(campaignsPath, "utf-8"));
const rows = campaigns
  .map((c) => ({
    id: c.id,
    brand: c.brand,
    title: c.title,
    year: c.year,
    thumbnailUrl: c.thumbnailUrl || ""
  }))
  .filter((row) => row.thumbnailUrl);

const uniqueUrls = [...new Set(rows.map((r) => normalizeUrl(r.thumbnailUrl)).filter(Boolean))];
console.log(`Campaign rows with thumbnailUrl: ${rows.length}`);
console.log(`Unique thumbnails to audit: ${uniqueUrls.length}`);

const audits = await runPool(uniqueUrls, async (url) => ({ url, ...(await auditThumbnail(url)) }), CONCURRENCY);
const byUrl = new Map(audits.map((a) => [a.url, a]));

const rowResults = rows.map((row) => {
  const url = normalizeUrl(row.thumbnailUrl);
  const audit = byUrl.get(url) || { status: 0, finalUrl: "", class: "dead", note: "missing_audit" };
  return {
    id: row.id,
    brand: row.brand,
    title: row.title,
    year: row.year,
    url,
    ...audit
  };
});

const summary = rowResults.reduce((acc, row) => {
  acc[row.class] = (acc[row.class] || 0) + 1;
  return acc;
}, {});

const notes = rowResults.reduce((acc, row) => {
  if (!row.note) return acc;
  acc[row.note] = (acc[row.note] || 0) + 1;
  return acc;
}, {});

const hostStats = {};
for (const row of rowResults) {
  const host = normalizeHost(row.url) || "invalid";
  if (!hostStats[host]) {
    hostStats[host] = { total: 0, dead: 0, likely_incorrect: 0 };
  }
  hostStats[host].total += 1;
  if (row.class === "dead") hostStats[host].dead += 1;
  if (row.class === "likely_incorrect") hostStats[host].likely_incorrect += 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    campaigns: campaigns.length,
    withThumbnailUrl: rows.length,
    uniqueUrls: uniqueUrls.length
  },
  summary,
  notes,
  topProblemHosts: Object.entries(hostStats)
    .map(([host, values]) => ({
      host,
      ...values,
      problems: values.dead + values.likely_incorrect
    }))
    .sort((a, b) => b.problems - a.problems)
    .slice(0, 50),
  rows: rowResults
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
console.log(`Wrote ${outPath}`);
console.log("Summary:", summary);
