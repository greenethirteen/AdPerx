import fs from "node:fs";
import path from "node:path";
import ytsr from "ytsr";

const DATA_PATH = path.resolve("data/campaigns.json");
const NOW_YEAR = new Date().getUTCFullYear();
const END_YEAR = Number(process.env.END_YEAR || String(NOW_YEAR - 1));
const START_YEAR = Number(process.env.START_YEAR || String(END_YEAR - 9));
const MAX_PER_YEAR = Math.max(1, Number(process.env.MAX_PER_YEAR || "30"));
const LIMIT_PER_QUERY = Math.max(5, Math.min(20, Number(process.env.LIMIT_PER_QUERY || "20")));
const MIN_DURATION_SEC = Math.max(5, Number(process.env.MIN_DURATION_SEC || "10"));
const MAX_DURATION_SEC = Math.max(MIN_DURATION_SEC, Number(process.env.MAX_DURATION_SEC || "360"));

const REJECT_TITLE_TERMS = [
  "compilation",
  "top ",
  "funniest",
  "reaction",
  "trailer",
  "teaser",
  "halftime",
  "highlights",
  "countdown",
  "ranked",
  "ranking",
  "playlist",
  "best ads",
  "all ads",
  "all commercials",
];

const SEARCH_QUERIES = (year) => [
  `super bowl ${year} commercial`,
  `super bowl ${year} ad`,
  `big game ${year} commercial`,
];

function parseDurationToSeconds(raw) {
  if (!raw) return 0;
  const parts = String(raw)
    .split(":")
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n));
  if (!parts.length) return 0;
  let total = 0;
  for (const n of parts) total = total * 60 + n;
  return total;
}

function extractYoutubeId(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (host.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    }
    if (host.includes("youtu.be")) {
      const v = u.pathname.split("/").filter(Boolean)[0] || "";
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
    }
  } catch {}
  return "";
}

function normalizeWatchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

function cleanText(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function guessBrand(title, author) {
  const raw = cleanText(title);
  const cuts = [" - ", " | ", " : ", " — "];
  for (const c of cuts) {
    const idx = raw.indexOf(c);
    if (idx > 1) {
      const left = raw.slice(0, idx).trim();
      const lower = left.toLowerCase();
      if (left.length <= 40 && !lower.includes("super bowl") && !lower.includes("big game")) {
        return left.toUpperCase();
      }
    }
  }
  const fallback = cleanText(author);
  if (fallback && fallback.length <= 40) return fallback.toUpperCase();
  return "";
}

function scoreVideo(item, year) {
  const title = cleanText(item.title);
  const t = title.toLowerCase();
  const dur = parseDurationToSeconds(item.duration);

  if (!t) return -1000;
  if (dur > 0 && (dur < MIN_DURATION_SEC || dur > MAX_DURATION_SEC)) return -1000;
  for (const bad of REJECT_TITLE_TERMS) {
    if (t.includes(bad)) return -1000;
  }

  let score = 0;
  if (t.includes("super bowl")) score += 40;
  if (t.includes("big game")) score += 20;
  if (t.includes("commercial")) score += 25;
  if (/\bad\b/.test(t)) score += 8;
  if (t.includes(String(year))) score += 10;
  if (dur >= 15 && dur <= 180) score += 8;
  if (dur > 180 && dur <= 360) score += 2;
  if (t.includes("official")) score += 4;
  if (t.includes("full")) score -= 2;
  return score;
}

async function searchQuery(query) {
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args) => {
    const msg = args.map((a) => String(a)).join(" ");
    if (
      msg.includes("failed at func parseItem") ||
      msg.includes("pls post the the files") ||
      msg.includes("gridShelfViewModel") ||
      msg.includes("lockupViewModel") ||
      msg.includes("canonicalBaseUrl")
    ) {
      return;
    }
    originalError(...args);
  };
  console.log = (...args) => {
    const msg = args.map((a) => String(a)).join(" ");
    if (
      msg.includes("********************************************************************************************************************************************************************************************************") ||
      msg.includes("ytsr: 3.8.4") ||
      msg.includes("os: darwin")
    ) {
      return;
    }
    originalLog(...args);
  };
  try {
    const result = await ytsr(query, { limit: LIMIT_PER_QUERY });
    return (result.items || []).filter((x) => x.type === "video");
  } catch (err) {
    console.error(`Search failed for query: ${query}`, err?.message || err);
    return [];
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
}

async function collectYear(year) {
  const byId = new Map();
  for (const query of SEARCH_QUERIES(year)) {
    const items = await searchQuery(query);
    for (const item of items) {
      const id = extractYoutubeId(item.url);
      if (!id) continue;
      const existing = byId.get(id);
      const scored = {
        id,
        title: cleanText(item.title),
        url: normalizeWatchUrl(id),
        author: cleanText(item.author?.name || ""),
        duration: cleanText(item.duration || ""),
        score: scoreVideo(item, year),
      };
      if (!existing || scored.score > existing.score) byId.set(id, scored);
    }
  }
  return Array.from(byId.values())
    .filter((x) => x.score >= 35)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PER_YEAR);
}

function makeId(base, usedIds) {
  let out = base;
  let i = 2;
  while (usedIds.has(out)) {
    out = `${base}-${i}`;
    i += 1;
  }
  usedIds.add(out);
  return out;
}

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`Missing ${DATA_PATH}`);
  }
  const campaigns = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

  const usedIds = new Set(campaigns.map((c) => c.id).filter(Boolean));
  const usedVideoIds = new Set();
  for (const row of campaigns) {
    const id1 = extractYoutubeId(row.outboundUrl || "");
    const id2 = extractYoutubeId(row.sourceUrl || "");
    if (id1) usedVideoIds.add(id1);
    if (id2) usedVideoIds.add(id2);
  }

  const years = [];
  for (let y = START_YEAR; y <= END_YEAR; y += 1) years.push(y);
  const additions = [];

  for (const year of years) {
    const rows = await collectYear(year);
    let addedForYear = 0;
    for (const row of rows) {
      if (usedVideoIds.has(row.id)) continue;
      const baseId = `superbowl-${year}-${row.id.toLowerCase()}`;
      const campaignId = makeId(baseId, usedIds);
      additions.push({
        id: campaignId,
        title: row.title || `Super Bowl ${year} Ad`,
        brand: guessBrand(row.title, row.author),
        agency: "",
        year,
        sourceUrl: row.url,
        outboundUrl: row.url,
        awardTier: "Super Bowl",
        awardCategory: "Super Bowl Ads",
        categoryBucket: "Film",
        thumbnailUrl: `https://i.ytimg.com/vi/${row.id}/hqdefault.jpg`,
        formatHints: ["film", "video"],
        topics: ["sports"],
        industry: "",
        notes: `Imported from YouTube search for Super Bowl ${year}`,
      });
      usedVideoIds.add(row.id);
      addedForYear += 1;
    }
    console.log(`Year ${year}: candidates ${rows.length}, added ${addedForYear}`);
  }

  if (!additions.length) {
    console.log("No new Super Bowl records added.");
    return;
  }

  campaigns.push(...additions);
  fs.writeFileSync(DATA_PATH, JSON.stringify(campaigns, null, 2));
  console.log(`Added ${additions.length} Super Bowl records. New total: ${campaigns.length}`);
}

await main();
