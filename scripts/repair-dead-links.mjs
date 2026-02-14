import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";

const root = process.cwd();
const dataPath = path.join(root, "data", "campaigns.json");
const deadLinksPath = path.join(root, "data", "dead_links.json");

// Load .env.local if present
const envPath = path.join(root, ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

const HASDATA_API_KEY = process.env.HASDATA_API_KEY || "";
const MAX_FIXES = Number(process.env.MAX_FIXES ?? "300");
const USE_DEAD_LIST = process.env.USE_DEAD_LIST !== "0";
const SKIP_STATUS_CHECK = process.env.SKIP_STATUS_CHECK !== "0";
const SKIP_HASDATA = process.env.SKIP_HASDATA === "1";
const VIDEO_ONLY = process.env.VIDEO_ONLY === "1";
const DEFAULT_ALLOW_DOMAINS = "youtube.com,youtu.be,vimeo.com,dandad.org,clios.com,adsoftheworld.com,lbbonline.com";
const ALLOW_DOMAINS_RAW = Object.prototype.hasOwnProperty.call(process.env, "ALLOW_DOMAINS")
  ? process.env.ALLOW_DOMAINS
  : DEFAULT_ALLOW_DOMAINS;
const ALLOW_DOMAINS = (ALLOW_DOMAINS_RAW || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PREFERRED_VIDEO_DOMAINS = (process.env.PREFERRED_VIDEO_DOMAINS || "youtube.com,youtu.be,vimeo.com,player.vimeo.com")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || "12000");
const SEARCH_ENGINE_HOSTS = new Set(["bing.com", "www.bing.com", "duckduckgo.com", "www.duckduckgo.com"]);

if (!fs.existsSync(dataPath)) {
  console.error("Missing data/campaigns.json");
  process.exit(1);
}
if (!HASDATA_API_KEY) {
  console.error("Missing HASDATA_API_KEY in environment.");
  process.exit(1);
}

function decodeBody(buf, encoding) {
  const enc = (encoding || "").toLowerCase();
  try {
    if (enc.includes("br")) return zlib.brotliDecompressSync(buf);
    if (enc.includes("gzip")) return zlib.gunzipSync(buf);
    if (enc.includes("deflate")) return zlib.inflateSync(buf);
  } catch {
    return buf;
  }
  return buf;
}

function requestUrl(url, { method = "GET", headers = {}, maxRedirects = 5, maxBytes = 150_000 } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method,
        headers: {
          "user-agent": "AdPerxBot/0.1 (metadata indexer)",
          "accept-encoding": "gzip, deflate, br",
          ...headers
        }
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;
        if (location && status >= 300 && status < 400 && maxRedirects > 0) {
          res.resume();
          const next = new URL(location, url).toString();
          requestUrl(next, { method, headers, maxRedirects: maxRedirects - 1, maxBytes })
            .then(resolve)
            .catch(reject);
          return;
        }
        const chunks = [];
        let total = 0;
        res.on("data", (c) => {
          chunks.push(c);
          total += c.length;
          if (method === "GET" && maxBytes && total > maxBytes) {
            res.destroy();
          }
        });
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          let decoded = decodeBody(raw, res.headers["content-encoding"]);
          if (maxBytes && decoded.length > maxBytes) decoded = decoded.subarray(0, maxBytes);
          resolve({
            status,
            headers: res.headers,
            body: decoded.toString("utf-8")
          });
        });
      }
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("request_timeout"));
    });
    req.on("error", () => resolve({ status: 0, headers: {}, body: "" }));
    req.end();
  });
}

async function fetchStatus(url) {
  try {
    const res = await requestUrl(url, { method: "HEAD", maxBytes: 0 });
    return res.status;
  } catch {
    return 0;
  }
}

async function searchHasData(query) {
  const url = `https://api.hasdata.com/scrape/bing/serp?q=${encodeURIComponent(query)}&count=5`;
  const res = await requestUrl(url, {
    headers: {
      "x-api-key": HASDATA_API_KEY
    }
  });
  if (res.status < 200 || res.status >= 400) return null;
  const json = JSON.parse(res.body || "{}");
  const results = json?.organic?.results ?? [];
  if (!Array.isArray(results)) return null;
  return results.map((r) => ({ url: r.url, title: r.title })).filter((r) => r.url);
}

async function searchBingHtml(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`;
  const res = await requestUrl(url, { maxBytes: 250_000 });
  if (res.status < 200 || res.status >= 400) return null;
  const html = res.body || "";
  const out = [];
  const rx = /<li[^>]*class=(?:"|')?b_algo(?:"|')?[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) && out.length < 8) {
    const u = m[1];
    const t = (m[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!u || u.includes("javascript:")) continue;
    out.push({ url: u, title: t });
  }
  return out.length ? out : null;
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

async function searchDuckDuckGoHtml(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await requestUrl(url, { maxBytes: 300_000 });
  if (res.status < 200 || res.status >= 400) return null;
  const html = res.body || "";
  const out = [];
  const rx = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = rx.exec(html)) && out.length < 8) {
    const normalized = normalizeFoundUrl(m[1]);
    if (!normalized || normalized.startsWith("javascript:")) continue;
    const title = (m[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    out.push({ url: normalized, title });
  }
  return out.length ? out : null;
}

function allowedDomain(url) {
  if (!ALLOW_DOMAINS.length) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return ALLOW_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isSearchEngineUrl(url) {
  const host = domainOf(url);
  return SEARCH_ENGINE_HOSTS.has(host);
}

function isPreferredVideo(url) {
  const host = domainOf(url);
  return PREFERRED_VIDEO_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function scoreCandidate(url, titleText) {
  let score = 0;
  const host = domainOf(url);
  if (!host) return -9999;
  if (isSearchEngineUrl(url)) return -9999;
  if (isPreferredVideo(url)) score += 100;
  if (allowedDomain(url)) score += 30;
  const lower = `${url} ${titleText || ""}`.toLowerCase();
  if (lower.includes("youtube") || lower.includes("youtu.be") || lower.includes("vimeo")) score += 20;
  if (lower.includes("case study") || lower.includes("film")) score += 5;
  return score;
}

function buildSearchQuery(record) {
  const base = `${record.title} ${record.brand} ${record.agency || ""} ${record.year || ""}`.trim();
  if (!VIDEO_ONLY) return base;
  return `${base} (site:youtube.com OR site:youtu.be OR site:vimeo.com)`;
}

function uniqResults(items) {
  const out = [];
  const seen = new Set();
  for (const item of items || []) {
    const u = (item?.url || "").trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push({ url: u, title: item?.title || "" });
  }
  return out;
}

function quickThumbnailFromUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `https://i.ytimg.com/vi/${v}/hqdefault.jpg`;
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace("/", "");
      if (id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    }
  } catch {
    return "";
  }
  return "";
}

function extractThumbnail(html, baseUrl) {
  const head = html.slice(0, 200000);
  const metaPatterns = [
    /property=["']og:image["'][^>]*content=["']([^"']+)["']/i,
    /name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /property=["']twitter:image["'][^>]*content=["']([^"']+)["']/i,
    /itemprop=["']image["'][^>]*content=["']([^"']+)["']/i,
    /rel=["']image_src["'][^>]*href=["']([^"']+)["']/i,
    /name=["']thumbnail["'][^>]*content=["']([^"']+)["']/i
  ];
  for (const rx of metaPatterns) {
    const m = head.match(rx);
    if (m?.[1]) {
      try {
        return new URL(m[1], baseUrl).toString();
      } catch {
        return "";
      }
    }
  }
  return "";
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
const deadList = USE_DEAD_LIST && fs.existsSync(deadLinksPath)
  ? JSON.parse(fs.readFileSync(deadLinksPath, "utf-8"))
  : [];
const deadSet = new Set(
  Array.isArray(deadList) ? deadList.map((x) => `${x.id}::${x.url}`) : []
);
let fixed = 0;
let checked = 0;
let hasDataFailures = 0;
const total = USE_DEAD_LIST && deadSet.size > 0
  ? data.filter((x) => x.outboundUrl && deadSet.has(`${x.id}::${x.outboundUrl}`)).length
  : data.filter((x) => x.outboundUrl).length;

if (USE_DEAD_LIST) {
  console.log(`Using dead-link list: ${deadSet.size} candidates from ${deadLinksPath}`);
}
if (VIDEO_ONLY) {
  console.log(`Video-only mode enabled: only YouTube/Vimeo candidates will be accepted.`);
}

async function safeRequest(fn, retries = 2) {
  let lastErr;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 + i * 500));
    }
  }
  throw lastErr;
}

let lastLog = Date.now();
for (const r of data) {
  if (fixed >= MAX_FIXES) break;
  if (!r.outboundUrl) continue;
  if (USE_DEAD_LIST && deadSet.size > 0 && !deadSet.has(`${r.id}::${r.outboundUrl}`)) continue;
  checked += 1;
  if (Date.now() - lastLog > 2000) {
    console.log(`Heartbeat: checked ${checked} / ${total}, fixed ${fixed}`);
    lastLog = Date.now();
  }
  if (!(USE_DEAD_LIST && SKIP_STATUS_CHECK)) {
    const status = await fetchStatus(r.outboundUrl);
    if (status && status < 400) continue;
  }

  const q = buildSearchQuery(r);
  let results = null;
  if (!SKIP_HASDATA) {
    try {
      results = await safeRequest(() => searchHasData(q));
    } catch {
      hasDataFailures += 1;
    }
  }
  if (!results?.length) {
    try {
      results = await safeRequest(() => searchDuckDuckGoHtml(q));
    } catch {
      // ignore
    }
  }
  if (!results?.length) {
    try {
      results = await safeRequest(() => searchBingHtml(q));
    } catch {
      // ignore
    }
  }
  if (!results?.length) continue;

  const candidates = uniqResults(results)
    .map((x) => ({ ...x, score: scoreCandidate(x.url, x.title) }))
    .filter((x) => (VIDEO_ONLY ? isPreferredVideo(x.url) : true))
    .filter((x) => x.score > -1000)
    .sort((a, b) => b.score - a.score);
  if (!candidates.length) continue;

  let best = null;
  for (const c of candidates.slice(0, 6)) {
    const s = await fetchStatus(c.url);
    if (s && s < 400) {
      best = c;
      break;
    }
  }
  if (!best) best = candidates[0];
  if (!best?.url) continue;

  r.outboundUrl = best.url;
  const quick = quickThumbnailFromUrl(best.url);
  if (quick) {
    r.thumbnailUrl = quick;
  } else {
    try {
      const page = await safeRequest(() => requestUrl(best.url));
      const thumb = extractThumbnail(page.body, best.url);
      if (thumb) r.thumbnailUrl = thumb;
    } catch {
      // ignore
    }
  }
  fixed += 1;
  if (fixed % 25 === 0) {
    fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`Progress: fixed ${fixed} / ${MAX_FIXES} (checked ${checked} / ${total})`);
  }
  if (checked % 50 === 0) {
    console.log(`Progress: checked ${checked} / ${total}, fixed ${fixed}, hasDataFailures ${hasDataFailures}`);
  }
}

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");
console.log(`✅ Done. Fixed ${fixed} links (checked ${checked} / ${total}, hasDataFailures ${hasDataFailures}).`);
