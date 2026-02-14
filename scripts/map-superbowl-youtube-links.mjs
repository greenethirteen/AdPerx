import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const campaignsPath = path.join(root, "data", "campaigns.json");
const linksPath = path.join(root, "data", "superbowl_youtube_links.json");
const reportPath = path.join(root, "data", "superbowl_youtube_mapping_report.json");

const STOP = new Set([
  "super",
  "bowl",
  "big",
  "game",
  "ad",
  "ads",
  "commercial",
  "commercials",
  "tv",
  "spot",
  "teaser",
  "pre",
  "release",
  "official",
  "video",
  "featuring",
  "feat",
  "ft",
  "song",
  "by",
  "the",
  "a",
  "an",
  "and",
  "of",
  "with",
  "t1",
  "t2",
  "t3",
  "t4",
  "l",
  "li",
  "lii",
  "liii",
  "liv",
  "lv",
  "lvi",
  "lvii",
  "lviii",
  "lix",
  "lx"
]);

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return norm(s)
    .split(" ")
    .map((x) => x.trim())
    .filter((x) => x.length > 2 && !STOP.has(x));
}

function setFrom(s) {
  return new Set(tokens(s));
}

function jaccard(a, b) {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
}

function getVideoId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) return u.searchParams.get("v") || "";
    if (u.hostname === "youtu.be") return u.pathname.replace("/", "");
    return "";
  } catch {
    return "";
  }
}

function scoreMatch(campaign, video) {
  const cText = `${campaign.brand || ""} ${campaign.title || ""}`;
  const vText = video.title || "";
  const cSet = setFrom(cText);
  const vSet = setFrom(vText);
  let score = jaccard(cSet, vSet);

  const cNorm = norm(cText);
  const vNorm = norm(vText);
  if (cNorm && vNorm && (cNorm.includes(vNorm) || vNorm.includes(cNorm))) score += 0.2;

  const brand = norm(campaign.brand || "");
  if (brand && vNorm.includes(brand)) score += 0.15;

  const title = norm(campaign.title || "");
  if (title && vNorm.includes(title)) score += 0.2;

  return score;
}

function isYoutubeUrl(url) {
  try {
    const h = new URL(url || "").hostname.toLowerCase();
    return h.includes("youtube.com") || h === "youtu.be";
  } catch {
    return false;
  }
}

function ensureTopic(c, topic) {
  const cur = new Set((c.topics || []).map((t) => String(t).toLowerCase()));
  if (!cur.has(topic.toLowerCase())) c.topics = [...(c.topics || []), topic];
}

function main() {
  if (!fs.existsSync(campaignsPath) || !fs.existsSync(linksPath)) {
    console.error("Missing required data files");
    process.exit(1);
  }

  const campaigns = JSON.parse(fs.readFileSync(campaignsPath, "utf8"));
  const links = JSON.parse(fs.readFileSync(linksPath, "utf8"));

  const videosByYear = new Map();
  for (const p of links.playlists || []) {
    videosByYear.set(Number(p.year), p.videos || []);
  }

  const sbCampaigns = campaigns.filter((c) =>
    (c.topics || []).some((t) => String(t).toLowerCase() === "super bowl")
  );

  let updated = 0;
  let checked = 0;
  let skippedHasYoutube = 0;
  const usedVideoIds = new Set();
  const matched = [];
  const unmatched = [];

  for (const c of sbCampaigns) {
    checked++;
    const year = Number(c.year || 0);
    const vids = videosByYear.get(year);
    if (!vids || !vids.length) {
      unmatched.push({ id: c.id, year, brand: c.brand, title: c.title, reason: "no_year_playlist" });
      continue;
    }

    if (isYoutubeUrl(c.outboundUrl)) {
      skippedHasYoutube++;
      const vid = getVideoId(c.outboundUrl);
      if (vid) usedVideoIds.add(vid);
      continue;
    }

    let best = null;
    let second = null;
    for (const v of vids) {
      const vid = getVideoId(v.url);
      if (!vid || usedVideoIds.has(vid)) continue;
      const s = scoreMatch(c, v);
      const candidate = { video: v, score: s };
      if (!best || s > best.score) {
        second = best;
        best = candidate;
      } else if (!second || s > second.score) {
        second = candidate;
      }
    }

    if (!best) {
      unmatched.push({ id: c.id, year, brand: c.brand, title: c.title, reason: "no_candidate" });
      continue;
    }

    const margin = best.score - (second?.score ?? 0);
    const highConfidence = best.score >= 0.45 && margin >= 0.08;
    if (!highConfidence) {
      unmatched.push({
        id: c.id,
        year,
        brand: c.brand,
        title: c.title,
        reason: "low_confidence",
        best: { title: best.video.title, score: Number(best.score.toFixed(3)), url: best.video.url },
        second: second ? { title: second.video.title, score: Number(second.score.toFixed(3)), url: second.video.url } : null
      });
      continue;
    }

    const vid = getVideoId(best.video.url);
    c.outboundUrl = `https://www.youtube.com/watch?v=${vid}`;
    c.thumbnailUrl = `https://img.youtube.com/vi/${vid}/hqdefault.jpg`;
    ensureTopic(c, "super bowl");
    ensureTopic(c, "sports");
    usedVideoIds.add(vid);
    updated++;
    matched.push({
      id: c.id,
      year,
      brand: c.brand,
      title: c.title,
      youtubeTitle: best.video.title,
      youtubeUrl: c.outboundUrl,
      score: Number(best.score.toFixed(3)),
      margin: Number(margin.toFixed(3))
    });
  }

  fs.writeFileSync(campaignsPath, JSON.stringify(campaigns, null, 2));
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        checked,
        updated,
        skippedHasYoutube,
        unmatched: unmatched.length,
        matched,
        unmatchedItems: unmatched.slice(0, 1000)
      },
      null,
      2
    )
  );

  console.log(`checked=${checked} updated=${updated} skippedHasYoutube=${skippedHasYoutube} unmatched=${unmatched.length}`);
  console.log(`report: ${reportPath}`);
}

main();

