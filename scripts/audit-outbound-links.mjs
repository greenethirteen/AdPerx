import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const campaignsPath = path.join(root, "data", "campaigns.json");
const outPath = path.join(root, "data", "link_audit.json");

const CONCURRENCY = Number(process.env.CONCURRENCY || "20");
const TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || "8000");

const BAD_HOST_HINTS = new Set([
  "lovetheworkmore.com",
  "bing.com",
  "zhidao.baidu.com",
  "zhihu.com",
  "quizlet.com"
]);

function normalizeHost(raw) {
  try {
    return new URL(raw).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeUrl(raw) {
  if (!raw || typeof raw !== "string") return "";
  const u = raw.trim();
  if (!u) return "";
  try {
    return new URL(u).toString();
  } catch {
    return "";
  }
}

function parseYouTubeId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.split("/").filter(Boolean)[0] || "";
      return /^[A-Za-z0-9_-]{11}$/.test(id) ? id : "";
    }
    if (host.endsWith("youtube.com")) {
      const v = u.searchParams.get("v") || "";
      if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const parts = u.pathname.split("/").filter(Boolean);
      const maybe = parts[1] || "";
      if ((parts[0] === "shorts" || parts[0] === "embed") && /^[A-Za-z0-9_-]{11}$/.test(maybe)) return maybe;
    }
  } catch {
    return "";
  }
  return "";
}

function likelyWrongTarget(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const p = `${u.pathname}${u.search}`.toLowerCase();

    if (host === "lovetheworkmore.com") return "ltwm_listing";
    if (host === "bing.com" && p.startsWith("/ck/a")) return "bing_redirect";
    if (host === "clios.com" && p.includes("/winners-gallery/explore")) return "clios_winners_listing";
    if (host === "drive.google.com" && p.includes("/drive/folders/")) return "gdrive_folder";
    if (BAD_HOST_HINTS.has(host)) return "non_case_domain";
  } catch {
    return "invalid_url";
  }
  return "";
}

async function fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "AdPerxLinkAudit/1.0",
        ...opts.headers
      },
      method: opts.method || "GET"
    });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function auditUrl(url) {
  const normalized = normalizeUrl(url);
  if (!normalized) return { status: 0, finalUrl: "", class: "invalid_url", note: "parse_failed" };

  const wrong = likelyWrongTarget(normalized);

  let status = 0;
  let finalUrl = normalized;
  let res = await fetchWithTimeout(normalized, { method: "HEAD" });
  if (!res || (res.status >= 400 || res.status === 405 || res.status === 403)) {
    res = await fetchWithTimeout(normalized, { method: "GET" });
  }
  if (res) {
    status = res.status;
    finalUrl = res.url || normalized;
  }

  if (!res) return { status: 0, finalUrl, class: "dead", note: wrong || "network_error" };
  if (status >= 400) return { status, finalUrl, class: "dead", note: wrong || "http_error" };

  const ytId = parseYouTubeId(finalUrl);
  if (ytId) {
    const oembed = await fetchWithTimeout(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${ytId}&format=json`, { method: "GET" });
    if (!oembed || oembed.status >= 400) {
      return { status, finalUrl, class: "unavailable", note: `youtube_unavailable_${oembed?.status || 0}` };
    }
  }

  if (wrong) return { status, finalUrl, class: "likely_incorrect", note: wrong };
  return { status, finalUrl, class: "ok", note: "" };
}

async function runPool(items, worker, n = 10) {
  const out = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: n }, async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) break;
      out[i] = await worker(items[i], i);
      if ((i + 1) % 200 === 0) {
        console.log(`Audited ${i + 1}/${items.length}`);
      }
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
const refs = campaigns
  .map((c) => ({ id: c.id, brand: c.brand, title: c.title, year: c.year, url: c.outboundUrl || "" }))
  .filter((x) => x.url);

const unique = [...new Set(refs.map((x) => normalizeUrl(x.url)).filter(Boolean))];
console.log(`Campaign rows with outboundUrl: ${refs.length}`);
console.log(`Unique URLs to audit: ${unique.length}`);

const auditRows = await runPool(unique, async (url) => ({ url, ...(await auditUrl(url)) }), CONCURRENCY);
const byUrl = new Map(auditRows.map((r) => [r.url, r]));

const rowResults = refs.map((r) => {
  const nurl = normalizeUrl(r.url);
  const a = byUrl.get(nurl) || { status: 0, finalUrl: "", class: "dead", note: "missing_audit" };
  return { ...r, ...a };
});

const summary = rowResults.reduce((acc, r) => {
  acc[r.class] = (acc[r.class] || 0) + 1;
  return acc;
}, {});

const notes = rowResults.reduce((acc, r) => {
  if (!r.note) return acc;
  acc[r.note] = (acc[r.note] || 0) + 1;
  return acc;
}, {});

const byHost = {};
for (const r of rowResults) {
  const h = normalizeHost(r.url) || "invalid";
  if (!byHost[h]) byHost[h] = { total: 0, dead: 0, unavailable: 0, likely_incorrect: 0 };
  byHost[h].total += 1;
  if (r.class === "dead") byHost[h].dead += 1;
  if (r.class === "unavailable") byHost[h].unavailable += 1;
  if (r.class === "likely_incorrect") byHost[h].likely_incorrect += 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  totals: {
    campaigns: campaigns.length,
    withOutboundUrl: refs.length,
    uniqueUrls: unique.length
  },
  summary,
  notes,
  topProblemHosts: Object.entries(byHost)
    .map(([host, v]) => ({ host, ...v, problems: v.dead + v.unavailable + v.likely_incorrect }))
    .sort((a, b) => b.problems - a.problems)
    .slice(0, 50),
  rows: rowResults
};

fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf-8");
console.log(`Wrote ${outPath}`);
console.log("Summary:", summary);
