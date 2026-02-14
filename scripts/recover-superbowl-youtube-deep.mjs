import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const campaignsPath = path.join(root, "data", "campaigns.json");
const reportPath = path.join(root, "data", "superbowl_youtube_deep_report.json");

const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? "999999");
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "3");
const START_INDEX = Number(process.env.START_INDEX ?? "0");

const STOP = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "super",
  "bowl",
  "big",
  "game",
  "tv",
  "spot",
  "promo",
  "teaser",
  "official",
  "commercial",
  "ad",
  "feat",
  "featuring",
  "song",
  "by",
  "extended",
  "full"
]);

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return norm(s)
    .split(" ")
    .map((w) => w.trim())
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function setOf(s) {
  return new Set(tokens(s));
}

function overlap(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const v of a) if (b.has(v)) n += 1;
  return n / Math.max(a.size, b.size);
}

function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0;
  for (const v of a) if (b.has(v)) inter += 1;
  const uni = new Set([...a, ...b]).size;
  return uni ? inter / uni : 0;
}

function parseYtInitialData(html) {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

function extractVideos(initialData) {
  const out = [];
  const seen = new Set();

  function walk(node) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const v of node) walk(v);
      return;
    }

    const vr = node.videoRenderer;
    if (vr?.videoId && !seen.has(vr.videoId)) {
      seen.add(vr.videoId);
      const title =
        vr.title?.runs?.map((r) => r.text).join("") ||
        vr.title?.simpleText ||
        "";
      const channel =
        vr.ownerText?.runs?.map((r) => r.text).join("") ||
        vr.longBylineText?.runs?.map((r) => r.text).join("") ||
        "";
      const duration = vr.lengthText?.simpleText || vr.lengthText?.runs?.map((r) => r.text).join("") || "";
      out.push({
        videoId: vr.videoId,
        title,
        channel,
        duration,
        url: `https://www.youtube.com/watch?v=${vr.videoId}`
      });
      if (out.length >= 25) return;
    }
    for (const k of Object.keys(node)) walk(node[k]);
  }

  walk(initialData);
  return out;
}

async function searchYoutube(query) {
  const url = `https://www.youtube.com/results?hl=en&gl=US&search_query=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) return [];
  const html = await res.text();
  const data = parseYtInitialData(html);
  if (!data) return [];
  return extractVideos(data);
}

async function isVideoEmbeddable(videoUrl) {
  // oEmbed 404 usually means unavailable/deleted/private.
  const api = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`;
  try {
    const res = await fetch(api, { headers: { "user-agent": "Mozilla/5.0" } });
    return res.ok;
  } catch {
    return false;
  }
}

function penaltyForGarbage(title) {
  const t = norm(title);
  let p = 0;
  if (/\breaction\b/.test(t)) p += 0.25;
  if (/\bcompilation\b/.test(t)) p += 0.3;
  if (/\bbest ads\b/.test(t)) p += 0.2;
  if (/\branking\b/.test(t)) p += 0.2;
  if (/\bexplained\b/.test(t)) p += 0.15;
  if (/\blive stream\b/.test(t)) p += 0.3;
  return p;
}

function scoreCandidate(campaign, cand) {
  const campaignText = `${campaign.brand || ""} ${campaign.title || ""}`;
  const candText = `${cand.title || ""} ${cand.channel || ""}`;
  const cSet = setOf(campaignText);
  const vSet = setOf(candText);

  let s = 0;
  s += jaccard(cSet, vSet) * 0.7;
  s += overlap(cSet, vSet) * 0.5;

  const tn = norm(campaign.title || "");
  const vn = norm(cand.title || "");
  const bn = norm(campaign.brand || "");
  if (tn && vn && (vn.includes(tn) || tn.includes(vn))) s += 0.25;
  if (bn && vn.includes(bn)) s += 0.2;
  if (/\bsuper bowl\b|\bsuperbowl\b|\bbig game\b/.test(vn)) s += 0.15;
  if (campaign.year && new RegExp(String(campaign.year)).test(vn)) s += 0.1;

  s -= penaltyForGarbage(cand.title);
  return s;
}

function isIspotUrl(raw) {
  try {
    const h = new URL(raw || "").hostname.toLowerCase();
    return h === "ispot.tv" || h.endsWith(".ispot.tv");
  } catch {
    return false;
  }
}

function thumbFor(videoId) {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

function makeQueries(c) {
  const qs = [];
  const brand = c.brand || "";
  const title = c.title || "";
  const year = c.year ? String(c.year) : "";
  qs.push(`${brand} ${title} super bowl ${year} ad`);
  qs.push(`${brand} ${title} super bowl commercial`);
  qs.push(`${brand} ${title} ${year}`);
  if (isIspotUrl(c.outboundUrl || "")) {
    const slug = (c.outboundUrl || "").split("/").filter(Boolean).pop() || "";
    if (slug) qs.push(`${slug.replace(/-/g, " ")} super bowl`);
  }
  return [...new Set(qs.map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean))];
}

async function main() {
  const campaigns = JSON.parse(fs.readFileSync(campaignsPath, "utf8"));
  const targets = campaigns
    .filter(
      (c) =>
        (c.topics || []).some((t) => String(t).toLowerCase() === "super bowl") &&
        isIspotUrl(c.outboundUrl || "")
    )
    .slice(START_INDEX, START_INDEX + MAX_ITEMS);

  let idx = 0;
  let checked = 0;
  let replaced = 0;
  let noResults = 0;
  let lowConfidence = 0;
  let unavailable = 0;
  const matched = [];
  const failed = [];

  async function worker() {
    while (idx < targets.length) {
      const i = idx++;
      const c = targets[i];
      checked++;
      try {
        const queries = makeQueries(c);
        let candidates = [];
        for (const q of queries) {
          const rows = await searchYoutube(q);
          candidates = candidates.concat(rows);
          if (candidates.length >= 25) break;
        }
        // Dedup
        const seen = new Set();
        candidates = candidates.filter((x) => {
          if (!x.videoId || seen.has(x.videoId)) return false;
          seen.add(x.videoId);
          return true;
        });

        if (!candidates.length) {
          noResults++;
          failed.push({ id: c.id, year: c.year, brand: c.brand, title: c.title, reason: "no_results" });
          continue;
        }

        const scored = candidates
          .map((cand) => ({ cand, score: scoreCandidate(c, cand) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, 5);

        const best = scored[0];
        const second = scored[1];
        const margin = best.score - (second?.score ?? 0);
        if (best.score < 0.58 || margin < 0.08) {
          lowConfidence++;
          failed.push({
            id: c.id,
            year: c.year,
            brand: c.brand,
            title: c.title,
            reason: "low_confidence",
            best: { title: best.cand.title, url: best.cand.url, score: Number(best.score.toFixed(3)) }
          });
          continue;
        }

        const ok = await isVideoEmbeddable(best.cand.url);
        if (!ok) {
          unavailable++;
          failed.push({
            id: c.id,
            year: c.year,
            brand: c.brand,
            title: c.title,
            reason: "youtube_unavailable",
            best: { title: best.cand.title, url: best.cand.url, score: Number(best.score.toFixed(3)) }
          });
          continue;
        }

        c.outboundUrl = best.cand.url;
        c.thumbnailUrl = thumbFor(best.cand.videoId);
        replaced++;
        matched.push({
          id: c.id,
          year: c.year,
          brand: c.brand,
          title: c.title,
          youtubeTitle: best.cand.title,
          youtubeUrl: best.cand.url,
          score: Number(best.score.toFixed(3))
        });
      } catch (err) {
        failed.push({
          id: c.id,
          year: c.year,
          brand: c.brand,
          title: c.title,
          reason: "error",
          error: String(err)
        });
      }

      if (checked % 50 === 0) {
        console.log(`progress: checked=${checked}/${targets.length} replaced=${replaced} noResults=${noResults} lowConfidence=${lowConfidence} unavailable=${unavailable}`);
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker());
  await Promise.all(workers);

  fs.writeFileSync(campaignsPath, JSON.stringify(campaigns, null, 2));
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        startIndex: START_INDEX,
        maxItems: MAX_ITEMS,
        concurrency: CONCURRENCY,
        checked,
        replaced,
        noResults,
        lowConfidence,
        unavailable,
        matched,
        failed
      },
      null,
      2
    )
  );
  console.log(`done: checked=${checked} replaced=${replaced} noResults=${noResults} lowConfidence=${lowConfidence} unavailable=${unavailable}`);
  console.log(`report: ${reportPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

