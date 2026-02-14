import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import { File, Blob } from "node:buffer";

if (!globalThis.File) globalThis.File = File;
if (!globalThis.Blob) globalThis.Blob = Blob;

const { load: loadHtml } = await import("cheerio");

// Node 18+ has global fetch
const ROOT = "https://lovetheworkmore.com";
const OUT = path.join(process.cwd(), "data", "campaigns.json");

// Gentle defaults
const SLEEP_MS = 600;
const MAX_PAGES = 200; // safety
const CURRENT_YEAR = new Date().getFullYear();
let MIN_YEAR = CURRENT_YEAR - 9;
let MAX_YEAR = CURRENT_YEAR;
const ENRICH_THUMBNAILS = process.env.ENRICH_THUMBNAILS !== "0";
const MAX_THUMBNAILS = Number(process.env.MAX_THUMBNAILS ?? "1200");
const HASDATA_API_KEY = process.env.HASDATA_API_KEY || "";
const RESUME = process.env.RESUME !== "0";
const THUMBNAILS_ONLY = process.env.THUMBNAILS_ONLY === "1";
const DEBUG_THUMBS = process.env.DEBUG_THUMBS === "1";
const THUMB_DOMAINS = (process.env.THUMB_DOMAINS || "").split(",").map((s) => s.trim()).filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normSpace(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function slugify(s) {
  return normSpace(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function inferIndustry({ title, brand }) {
  const t = `${title} ${brand}`.toLowerCase();

  const airlineBrands = [
    "emirates","qatar airways","etihad","singapore airlines","lufthansa","klm","air france",
    "delta","united","american airlines","ryanair","easyjet","turkish airlines","ana","jal",
    "air canada","british airways","virgin atlantic","saudia","flynas","flydubai","airasia",
    "aeromexico","aeromexicanos","latam","avianca","indigo","spicejet","air india","sri lankan"
  ];

  if (airlineBrands.some((b) => t.includes(b))) return "airlines";
  if (/(airline|airport|aviation|boarding|flight|fly|air\s)/.test(t)) return "airlines";
  if (/(bank|finance|credit|card|loan|insurance)/.test(t)) return "finance";
  if (/(car|auto|mobility|electric vehicle|ev|truck)/.test(t)) return "automotive";
  if (/(telco|telecom|mobile|5g|sim)/.test(t)) return "telecom";
  if (/(beer|whisky|vodka|gin|wine)/.test(t)) return "alcohol";
  if (/(health|hospital|cancer|hiv|mental health)/.test(t)) return "health";
  if (/(hotel|resort|travel|tourism)/.test(t)) return "travel";
  return "";
}

function inferTopics({ title }) {
  const t = `${title}`.toLowerCase();
  const topics = [];
  if (/(women|girl|equality|femin|sexism)/.test(t)) topics.push("women's rights");
  if (/(climate|sustain|carbon|plastic|ocean)/.test(t)) topics.push("sustainability");
  if (/(refugee|migration|human rights)/.test(t)) topics.push("human rights");
  if (/(football|soccer|sport|olympic)/.test(t)) topics.push("sports");
  if (/(ai|artificial intelligence|machine learning)/.test(t)) topics.push("ai");
  return topics;
}

function parseAwardTier(text) {
  const t = String(text ?? "").toLowerCase();
  if (t.includes("grand prix") || t.includes("titanium")) return "Grand Prix";
  if (t.includes("gold")) return "Gold";
  if (t.includes("silver")) return "Silver";
  if (t.includes("bronze")) return "Bronze";
  if (t.includes("shortlist")) return "Shortlist";
  return "";
}

function detectAwardTier(text) {
  const t = normSpace(text);
  if (!t || t.length > 40) return "";
  if (!/(grand prix|titanium|gold|silver|bronze|shortlist)/i.test(t)) return "";
  return parseAwardTier(t);
}

function normalizeCategory(raw) {
  const t = String(raw ?? "").toLowerCase();
  if (!t) return "";
  if (t.includes("film craft")) return "Film Craft";
  if (t.includes("film")) return "Film";
  if (t.includes("print")) return "Print";
  if (t.includes("radio") || t.includes("audio")) return "Radio/Audio";
  if (t.includes("outdoor") || t.includes("ooh")) return "Outdoor";
  if (t.includes("digital craft")) return "Digital Craft";
  if (t.includes("digital")) return "Digital";
  if (t.includes("design")) return "Design";
  if (t.includes("pr")) return "PR";
  if (t.includes("direct")) return "Direct";
  if (t.includes("media")) return "Media";
  if (t.includes("social") || t.includes("influencer")) return "Social/Influencer";
  if (t.includes("health") || t.includes("pharma")) return "Health";
  if (t.includes("innovation")) return "Innovation";
  if (t.includes("creative data")) return "Data";
  if (t.includes("brand experience") || t.includes("activation")) return "Brand Experience";
  if (t.includes("entertainment")) return "Entertainment";
  if (t.includes("commerce")) return "Commerce";
  if (t.includes("sustainable development goals") || t.includes("sdg") || t.includes("good")) return "Good/SDG";
  if (t.includes("craft")) return "Craft";
  return "Other";
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

function requestUrl(url, { method = "GET", headers = {}, maxRedirects = 5, maxBytes = 2_000_000 } = {}) {
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
          requestUrl(next, { method, headers, maxRedirects: maxRedirects - 1 })
            .then(resolve)
            .catch(reject);
          return;
        }
        const chunks = [];
        let total = 0;
        res.on("data", (c) => {
          chunks.push(c);
          total += c.length;
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
    req.on("error", reject);
    req.end();
  });
}

async function fetchHtml(url) {
  const res = await requestUrl(url, { maxBytes: 2_000_000 });
  if (res.status < 200 || res.status >= 400) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.body;
}

async function fetchStatus(url) {
  const res = await requestUrl(url, { method: "HEAD" });
  return res.status;
}

async function searchHasData(query) {
  if (!HASDATA_API_KEY) return null;
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

async function resolveClioLink(record) {
  const outbound = record.outboundUrl || "";
  if (!outbound.includes("clios.com")) return outbound;
  try {
    const status = await fetchStatus(outbound);
    if (status >= 200 && status < 400) return outbound;
  } catch {
    // fall through to search
  }
  const q = `${record.brand} ${record.title} clios`;
  const results = await searchHasData(q);
  if (!results?.length) return outbound;
  const best = results.find((r) => r.url.includes("clios.com")) ?? results[0];
  return best?.url || outbound;
}

function absoluteUrl(href) {
  if (!href) return "";
  try {
    return new URL(href, ROOT).toString();
  } catch {
    return "";
  }
}

function absoluteUrlWithBase(href, baseUrl) {
  if (!href) return "";
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return "";
  }
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
      const url = absoluteUrlWithBase(m[1], baseUrl);
      if (url) return url;
    }
  }
  // Light fallback: first reasonable <img>
  const imgMatch = head.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch?.[1]) {
    const url = absoluteUrlWithBase(imgMatch[1], baseUrl);
    if (url && !/data:|\.svg($|\\?)/i.test(url) && !/logo|icon|sprite/i.test(url)) return url;
  }
  return "";
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
    if (u.hostname.includes("vimeo.com")) {
      // No cheap direct thumb without API; let HTML fetch handle it
      return "";
    }
  } catch {
    return "";
  }
  return "";
}

function allowedDomain(url) {
  if (!THUMB_DOMAINS.length) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return THUMB_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

function generateYearPages() {
  const urls = [];
  for (let y = MIN_YEAR; y <= MAX_YEAR; y += 1) {
    urls.push(`${ROOT}/${y}-2/`);
    urls.push(`${ROOT}/${y}/`);
  }
  return urls;
}

function parseYearsArg() {
  const idx = process.argv.indexOf("--years");
  if (idx === -1) return;
  const raw = process.argv[idx + 1];
  if (!raw) return;
  const m = raw.match(/^(\d{4})-(\d{4})$/);
  if (!m) return;
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return;
  MIN_YEAR = Math.min(min, max);
  MAX_YEAR = Math.max(min, max);
}

function parseYearPage(url, html) {
  const $ = loadHtml(html);

  // Heuristic: entries look like "TITLE – BRAND (AGENCY)"
  // Often in plain text blocks; sometimes as list items; sometimes as paragraphs.
  const candidates = [];
  let currentTier = "";

  const pushLine = (line, outboundUrl, awardTier) => {
    const raw = normSpace(line);
    if (!raw) return;
    // Avoid nav / noise
    if (raw.length < 6) return;
    if (/calling for link donations/i.test(raw)) return;

    candidates.push({ raw, outboundUrl: outboundUrl || "", awardTier: awardTier || "" });
  };

  // Walk elements in document order to track award tier headings
  $("body")
    .find("h1, h2, h3, h4, h5, h6, p, li, a, strong, em")
    .each((_, el) => {
      const $el = $(el);
      const text = normSpace($el.text());
      if (!text) return;
      const tier = detectAwardTier(text);
      if (tier) {
        currentTier = tier;
        return;
      }
      if ($el.is("a")) {
        const href = $el.attr("href") || "";
        if (href.startsWith("#")) return;
        if (text.length < 6) return;
        const abs = absoluteUrl(href);
        const outbound = abs.startsWith(ROOT) ? "" : abs;
        pushLine(text, outbound, currentTier);
        return;
      }
      if ($el.is("li") || $el.is("p")) {
        for (const line of text.split(/\n|•|\u00b7/g)) {
          const l = normSpace(line);
          if (l.length >= 6) pushLine(l, "", currentTier);
        }
      }
    });

  // Deduplicate by raw, prefer entries with outboundUrl
  const map = new Map();
  for (const c of candidates) {
    const key = `${c.raw.toLowerCase()}|${c.awardTier}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, c);
      continue;
    }
    if (!prev.outboundUrl && c.outboundUrl) {
      map.set(key, c);
    }
  }
  const unique = [...map.values()];

  // Parse into fields
  const records = [];
  const yearMatch = url.match(/\/(\d{4})/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  if (!year || year < MIN_YEAR || year > CURRENT_YEAR) return [];

  for (const c of unique) {
    let line = c.raw;
    let awardCategory = "";
    let categoryBucket = "";
    const catMatch = line.match(/^\[([^\]]+)\]\s*/);
    if (catMatch) {
      awardCategory = normSpace(catMatch[1]);
      categoryBucket = normalizeCategory(awardCategory);
      line = normSpace(line.slice(catMatch[0].length));
    }
    // Common pattern: TITLE – BRAND (AGENCY)
    const parts = line.split(/\s+–\s+|\s+-\s+/);
    if (parts.length < 2) continue;

    const title = normSpace(parts[0]);
    const rest = normSpace(parts.slice(1).join(" – "));
    // Extract agency in parentheses at end
    const agencyMatch = rest.match(/\(([^)]+)\)\s*$/);
    const agency = agencyMatch ? normSpace(agencyMatch[1]) : "";
    const brand = normSpace(rest.replace(/\s*\([^)]+\)\s*$/, ""));

    if (!title || !brand) continue;

    const id = `${year || "unknown"}-${slugify(title)}-${slugify(brand)}`.slice(0, 120);

    const rec = {
      id,
      title,
      brand,
      agency,
      year: year || 0,
      sourceUrl: url,
      outboundUrl: c.outboundUrl || "",
      awardTier: c.awardTier || "",
      awardCategory,
      categoryBucket,
      thumbnailUrl: "",
      formatHints: [],
      topics: inferTopics({ title }),
      industry: inferIndustry({ title, brand }),
      notes: ""
    };
    records.push(rec);
  }

  return records;
}

async function main() {
  parseYearsArg();
  if (THUMBNAILS_ONLY) {
    if (!fs.existsSync(OUT)) {
      console.error("Missing data/campaigns.json. Run a metadata scrape first.");
      process.exit(1);
    }
    const existing = JSON.parse(fs.readFileSync(OUT, "utf-8"));
    let thumbCount = 0;
    let thumbAttempts = 0;
    let thumbErrors = 0;
    const persist = () => {
      fs.writeFileSync(OUT, JSON.stringify(existing, null, 2), "utf-8");
    };

    const onExit = () => {
      try {
        persist();
        console.log(`Saved progress: ${thumbCount} thumbs, ${thumbAttempts} attempts, ${thumbErrors} errors`);
      } catch {
        // ignore
      }
      process.exit(0);
    };
    process.once("SIGINT", onExit);
    process.once("SIGTERM", onExit);

    for (const r of existing) {
      if (thumbCount >= MAX_THUMBNAILS) break;
      if (r.thumbnailUrl) continue;
      if (!r.outboundUrl && !r.sourceUrl) continue;
      if (THUMB_DOMAINS.length && r.outboundUrl && !allowedDomain(r.outboundUrl) && r.sourceUrl && !allowedDomain(r.sourceUrl)) {
        continue;
      }
      if (r.outboundUrl?.includes("clios.com")) {
        const resolved = await resolveClioLink(r);
        if (resolved && resolved !== r.outboundUrl) r.outboundUrl = resolved;
      }
      const targets = [r.outboundUrl, r.sourceUrl].filter(Boolean).filter((u) => allowedDomain(u));
      try {
        for (const target of targets) {
          if (r.thumbnailUrl) break;
          if (DEBUG_THUMBS) console.log("thumb:try", target);
          const quick = quickThumbnailFromUrl(target);
          if (quick) {
            r.thumbnailUrl = quick;
            thumbCount += 1;
            thumbAttempts += 1;
            persist();
            if (DEBUG_THUMBS) console.log("thumb:quick", quick);
            continue;
          }
          const page = await fetchHtml(target);
          const thumb = extractThumbnail(page, target);
          thumbAttempts += 1;
          if (thumb) {
            r.thumbnailUrl = thumb;
            thumbCount += 1;
            persist();
            if (DEBUG_THUMBS) console.log("thumb:found", thumb);
          }
          // Let GC reclaim large strings sooner
          await sleep(5);
        }
      } catch {
        thumbErrors += 1;
      }
      if ((thumbAttempts + thumbErrors) % 25 === 0) {
        console.log(`Progress: ${thumbCount} thumbs, ${thumbAttempts} attempts, ${thumbErrors} errors`);
      }
      await sleep(200);
    }

    persist();
    console.log(`Thumbnails: ${thumbCount} added, ${thumbAttempts} attempts, ${thumbErrors} errors`);
    console.log(`✅ Wrote ${OUT} with ${existing.length} records`);
    return;
  }
  const yearPages = generateYearPages().slice(0, MAX_PAGES);

  if (!yearPages.length) {
    console.error("Could not find year pages. Site structure may have changed.");
    process.exit(1);
  }

  console.log(`Target years: ${MIN_YEAR}–${CURRENT_YEAR}`);
  console.log(`Found ${yearPages.length} year-ish pages. Crawling (max ${MAX_PAGES})…`);

  const all = [];
  let thumbCount = 0;
  let thumbAttempts = 0;
  let thumbErrors = 0;
  for (const [i, url] of yearPages.entries()) {
    console.log(`[${i + 1}/${yearPages.length}] ${url}`);
    try {
      const html = await fetchHtml(url);
      const recs = parseYearPage(url, html);
      console.log(`  → ${recs.length} records`);

      if (ENRICH_THUMBNAILS) {
        for (const r of recs) {
          if (thumbCount >= MAX_THUMBNAILS) break;
          if (r.thumbnailUrl) continue;
          if (!r.outboundUrl && !r.sourceUrl) continue;
          if (RESUME && r.thumbnailUrl) continue;
          if (THUMB_DOMAINS.length && r.outboundUrl && !allowedDomain(r.outboundUrl) && r.sourceUrl && !allowedDomain(r.sourceUrl)) {
            continue;
          }
          if (r.outboundUrl?.includes("clios.com")) {
            const resolved = await resolveClioLink(r);
            if (resolved && resolved !== r.outboundUrl) r.outboundUrl = resolved;
          }
          const targets = [r.outboundUrl, r.sourceUrl].filter(Boolean).filter((u) => allowedDomain(u));
          if (!targets.length) continue;
          try {
            for (const target of targets) {
              if (r.thumbnailUrl) break;
          const quick = quickThumbnailFromUrl(target);
          if (quick) {
            r.thumbnailUrl = quick;
            thumbCount += 1;
            thumbAttempts += 1;
            continue;
          }
          const page = await fetchHtml(target);
          const thumb = extractThumbnail(page, target);
          thumbAttempts += 1;
          if (thumb) {
            r.thumbnailUrl = thumb;
            thumbCount += 1;
          }
          await sleep(5);
        }
      } catch {
        thumbErrors += 1;
      }
          await sleep(250);
        }
      }

      all.push(...recs);
    } catch (e) {
      const msg = String(e?.message || e);
      if (msg.includes("HTTP 404")) {
        console.warn(`  ↪️ Skipped (404)`);
      } else {
        console.warn(`  ⚠️ Failed: ${msg}`);
      }
    }
    await sleep(SLEEP_MS);
  }

  // Deduplicate by id
  const map = new Map();
  for (const r of all) map.set(r.id, r);
  let deduped = [...map.values()];

  // Resume: merge existing data so thumbnails/links aren't lost
  if (RESUME && fs.existsSync(OUT)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUT, "utf-8"));
      const byId = new Map(existing.map((x) => [x.id, x]));
      deduped = deduped.map((r) => {
        const prev = byId.get(r.id);
        if (!prev) return r;
        return {
          ...r,
          outboundUrl: r.outboundUrl || prev.outboundUrl || "",
          thumbnailUrl: r.thumbnailUrl || prev.thumbnailUrl || "",
          sourceUrl: r.sourceUrl || prev.sourceUrl || "",
          awardTier: r.awardTier || prev.awardTier || "",
          awardCategory: r.awardCategory || prev.awardCategory || "",
          categoryBucket: r.categoryBucket || prev.categoryBucket || ""
        };
      });
    } catch {
      // ignore resume failures
    }
  }

  deduped.sort((a, b) => (b.year || 0) - (a.year || 0));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(deduped, null, 2), "utf-8");
  if (ENRICH_THUMBNAILS) {
    console.log(`Thumbnails: ${thumbCount} added, ${thumbAttempts} attempts, ${thumbErrors} errors`);
  }
  console.log(`✅ Wrote ${OUT} with ${deduped.length} unique records`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
