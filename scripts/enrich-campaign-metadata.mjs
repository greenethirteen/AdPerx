import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CAMPAIGNS_PATH = path.join(ROOT, "data", "campaigns.json");
const ENRICH_PATH = path.join(ROOT, "data", "campaign_enrichment.json");
const AUDIT_PATH = path.join(ROOT, "data", "link_audit.json");

const args = new Map();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const key = a.slice(2);
    const next = process.argv[i + 1];
    if (!next || next.startsWith("--")) args.set(key, "true");
    else {
      args.set(key, next);
      i++;
    }
  }
}

const scope = (args.get("scope") || "all").toLowerCase(); // all | broken
const force = args.get("force") === "true";
const maxFetch = Number(args.get("max-fetch") || "1200");
const concurrency = Math.max(1, Number(args.get("concurrency") || "12"));
const timeoutMs = Math.max(1000, Number(args.get("timeout-ms") || "9000"));

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function clean(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(s, n) {
  const t = clean(s);
  if (!t) return "";
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function youtubeId(raw) {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    if (h.includes("youtube.com")) {
      if (u.pathname.startsWith("/watch")) return u.searchParams.get("v") || "";
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] || "";
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] || "";
      return u.searchParams.get("v") || "";
    }
    if (h === "youtu.be") return u.pathname.replace("/", "");
    return "";
  } catch {
    return "";
  }
}

function inferChannels(c, outboundUrl) {
  const set = new Set();
  for (const f of c.formatHints || []) set.add(String(f));
  if (/(youtube|vimeo)/i.test(outboundUrl || "")) set.add("video");
  if (/adsspot\.me/i.test(outboundUrl || "")) set.add("case study");
  if (/dandad|oneclub|clios/i.test(outboundUrl || "")) set.add("awards page");
  return [...set].filter(Boolean);
}

function inferKeywords(c) {
  const out = new Set();
  for (const t of c.topics || []) out.add(String(t).toLowerCase());
  for (const f of c.formatHints || []) out.add(String(f).toLowerCase());
  if (c.industry) out.add(String(c.industry).toLowerCase());
  if (c.awardTier) out.add(String(c.awardTier).toLowerCase());
  if (c.categoryBucket) out.add(String(c.categoryBucket).toLowerCase());
  return [...out].slice(0, 16);
}

function fallbackSummary(c) {
  const yr = c.year ? ` in ${c.year}` : "";
  const ag = c.agency ? ` by ${c.agency}` : "";
  return `${c.title} is a campaign for ${c.brand}${yr}${ag}.`;
}

function fetchWithTimeout(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    fetch(url, {
      ...opts,
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; AdPerxEnricher/1.0)",
        ...(opts.headers || {})
      }
    })
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

function metaContent(html, prop, attr = "property") {
  const rx = new RegExp(`<meta[^>]+${attr}=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const m = html.match(rx);
  return m ? m[1] : "";
}

async function fetchMetadata(url) {
  if (!url) return null;
  const yt = youtubeId(url);
  try {
    if (yt) {
      const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const res = await fetchWithTimeout(oembed);
      if (res.ok) {
        const j = await res.json();
        return {
          title: clean(j.title),
          description: "",
          thumbnailUrl: j.thumbnail_url || "",
          author: clean(j.author_name),
          source: "youtube_oembed"
        };
      }
      return null;
    }
    if (/vimeo\.com/i.test(url)) {
      const oembed = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(url)}`;
      const res = await fetchWithTimeout(oembed);
      if (res.ok) {
        const j = await res.json();
        return {
          title: clean(j.title),
          description: clean(j.description),
          thumbnailUrl: j.thumbnail_url || "",
          author: clean(j.author_name),
          source: "vimeo_oembed"
        };
      }
      return null;
    }

    const res = await fetchWithTimeout(url);
    if (!res.ok) return null;
    const html = await res.text();
    const title = clean(metaContent(html, "og:title") || metaContent(html, "twitter:title", "name"));
    const description = clean(
      metaContent(html, "og:description") ||
        metaContent(html, "twitter:description", "name") ||
        metaContent(html, "description", "name")
    );
    const thumbnailUrl = clean(metaContent(html, "og:image") || metaContent(html, "twitter:image", "name"));
    return { title, description, thumbnailUrl, author: "", source: "page_meta" };
  } catch {
    return null;
  }
}

function makeTargetCampaigns(campaigns, audit) {
  if (scope !== "broken") return campaigns;
  const brokenIds = new Set((audit.rows || []).filter((r) => r.class && r.class !== "ok").map((r) => r.id));
  return campaigns.filter((c) => brokenIds.has(c.id));
}

async function main() {
  if (!fs.existsSync(CAMPAIGNS_PATH)) {
    console.error("Missing data/campaigns.json");
    process.exit(1);
  }

  const campaigns = readJson(CAMPAIGNS_PATH, []);
  const audit = readJson(AUDIT_PATH, { rows: [] });
  const existing = readJson(ENRICH_PATH, {});
  const next = { ...existing };
  const today = new Date().toISOString().slice(0, 10);

  const targets = makeTargetCampaigns(campaigns, audit);
  const queue = [];
  let baselineOnly = 0;
  let already = 0;

  for (const c of targets) {
    const prev = next[c.id] || {};
    if (!force && prev.summary && prev.verifiedAt) {
      already++;
      continue;
    }

    const merged = {
      ...prev,
      channels: prev.channels?.length ? prev.channels : inferChannels(c, c.outboundUrl),
      keywords: prev.keywords?.length ? prev.keywords : inferKeywords(c),
      sourceUrls: [...new Set([...(prev.sourceUrls || []), c.outboundUrl, c.sourceUrl].filter(Boolean))],
      region: prev.region || "",
      language: prev.language || "",
      confidence: prev.confidence || "low"
    };

    if (!merged.summary) merged.summary = fallbackSummary(c);
    next[c.id] = merged;
    baselineOnly++;
    queue.push(c);
  }

  const fetchTargets = queue.filter((c) => c.outboundUrl).slice(0, maxFetch);
  let ptr = 0;
  let fetched = 0;
  let enrichedFromWeb = 0;

  async function worker() {
    while (ptr < fetchTargets.length) {
      const idx = ptr++;
      const c = fetchTargets[idx];
      const meta = await fetchMetadata(c.outboundUrl);
      fetched++;
      if (!meta) continue;

      const e = next[c.id] || {};
      const summaryFromMeta = meta.description ? truncate(meta.description, 320) : "";
      const hasBetterSummary =
        summaryFromMeta &&
        (!e.summary || /^.+ is a campaign for .+\.$/.test(String(e.summary)) || String(e.summary).length < 90);

      next[c.id] = {
        ...e,
        summary: hasBetterSummary ? summaryFromMeta : e.summary || fallbackSummary(c),
        sourceNotes: e.sourceNotes || `Auto-enriched from ${meta.source}.`,
        verifiedAt: today,
        confidence: meta.description ? "medium" : e.confidence || "low"
      };
      enrichedFromWeb++;
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  fs.writeFileSync(ENRICH_PATH, JSON.stringify(next, null, 2) + "\n");

  console.log(
    JSON.stringify(
      {
        scope,
        campaignsTotal: campaigns.length,
        targets: targets.length,
        alreadyEnriched: already,
        baselineSeeded: baselineOnly,
        webFetchAttempted: fetchTargets.length,
        webFetched: fetched,
        webEnriched: enrichedFromWeb,
        enrichmentEntries: Object.keys(next).length
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
