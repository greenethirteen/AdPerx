import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const campaignsPath = path.join(root, "data", "campaigns.json");
const reportPath = path.join(root, "data", "superbowl_youtube_from_ispot_title.report.json");

const CONCURRENCY = Number(process.env.CONCURRENCY ?? "3");
const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? "999999");

const STOP = new Set([
  "the","and","for","with","from","super","bowl","big","game","tv","spot","promo","teaser","official","commercial","ad","feat","featuring","song","by","extended","full","pre","release"
]);

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s) => norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w));
const setOf = (s) => new Set(tokens(s));
const isIspot = (u) => {
  try {
    const h = new URL(u || "").hostname.toLowerCase();
    return h === "ispot.tv" || h.endsWith(".ispot.tv");
  } catch {
    return false;
  }
};

function parseYtInitialData(html) {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function extractVideos(data) {
  const out = [];
  const seen = new Set();
  function walk(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    const vr = n.videoRenderer;
    if (vr?.videoId && !seen.has(vr.videoId)) {
      seen.add(vr.videoId);
      const title = (vr.title?.runs || []).map((r) => r.text).join("") || vr.title?.simpleText || "";
      const channel = (vr.ownerText?.runs || []).map((r) => r.text).join("") || "";
      out.push({ videoId: vr.videoId, title, channel, url: `https://www.youtube.com/watch?v=${vr.videoId}` });
      if (out.length >= 20) return;
    }
    for (const k of Object.keys(n)) walk(n[k]);
  }
  walk(data);
  return out;
}

async function ytSearch(q) {
  try {
    const url = `https://www.youtube.com/results?hl=en&gl=US&search_query=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) return [];
    const html = await res.text();
    const data = parseYtInitialData(html);
    if (!data) return [];
    return extractVideos(data);
  } catch {
    return [];
  }
}

async function ytEmbeddable(url) {
  const api = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  try {
    const res = await fetch(api, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchIspotTitle(url) {
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return "";
    const html = await res.text();
    const og = html.match(/property="og:title"\s+content="([^"]+)"/i);
    if (og?.[1]) return og[1].replace(/&#0?39;/g, "'").trim();
    const t = html.match(/<title>([^<]+)<\/title>/i);
    return (t?.[1] || "").trim();
  } catch {
    return "";
  }
}

function score(campaign, cand, ispotTitle) {
  const base = `${campaign.brand || ""} ${campaign.title || ""} ${ispotTitle || ""}`;
  const cSet = setOf(base);
  const vSet = setOf(`${cand.title || ""} ${cand.channel || ""}`);
  let inter = 0;
  for (const v of cSet) if (vSet.has(v)) inter++;
  const union = new Set([...cSet, ...vSet]).size || 1;
  let s = inter / union;

  const b = norm(campaign.brand || "").split(" ")[0] || "";
  const t = norm(campaign.title || "");
  const v = norm(cand.title || "");
  if (b && v.includes(b)) s += 0.18;
  if (t && (v.includes(t) || t.includes(v))) s += 0.2;
  if (/super bowl|superbowl|big game/.test(v)) s += 0.08;
  if (campaign.year && v.includes(String(campaign.year))) s += 0.06;
  if (/reaction|compilation|ranking|highlights|explained/.test(v)) s -= 0.2;
  return s;
}

async function main() {
  const campaigns = JSON.parse(fs.readFileSync(campaignsPath, "utf8"));
  const targets = campaigns.filter((c) =>
    (c.topics || []).some((t) => String(t).toLowerCase() === "super bowl") && isIspot(c.outboundUrl)
  ).slice(0, MAX_ITEMS);
  console.log(`targets=${targets.length}`);

  let idx = 0;
  let checked = 0;
  let replaced = 0;
  const failed = [];
  const matched = [];

  async function worker() {
    while (idx < targets.length) {
      const i = idx++;
      const c = targets[i];
      checked++;
      const ispotTitle = await fetchIspotTitle(c.outboundUrl || "");
      const queries = [
        ispotTitle,
        `${c.brand || ""} ${c.title || ""} super bowl ${c.year || ""} ad`,
        `${c.brand || ""} ${c.title || ""} super bowl commercial`
      ].map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean);
      let cands = [];
      for (const q of queries) {
        const rows = await ytSearch(q);
        cands = cands.concat(rows);
        if (cands.length >= 20) break;
      }
      const dedup = new Map();
      for (const c of cands) dedup.set(c.videoId, c);
      cands = [...dedup.values()];
      if (!cands.length) {
        failed.push({ id: c.id, reason: "no_candidates" });
        continue;
      }
      const ranked = cands
        .map((cand) => ({ cand, s: score(c, cand, ispotTitle) }))
        .sort((a, b) => b.s - a.s);
      const best = ranked[0];
      const second = ranked[1];
      const margin = best.s - (second?.s ?? 0);
      const brandFirst = norm(c.brand || "").split(" ")[0] || "";
      const titleN = norm(best.cand.title || "");
      const brandHit = brandFirst && titleN.includes(brandFirst);
      if (!(best.s >= 0.42 && margin >= 0.03 && brandHit)) {
        failed.push({ id: c.id, reason: "low_confidence", best: { title: best.cand.title, score: Number(best.s.toFixed(3)) } });
        continue;
      }
      const ok = await ytEmbeddable(best.cand.url);
      if (!ok) {
        failed.push({ id: c.id, reason: "youtube_unavailable", best: best.cand.url });
        continue;
      }
      c.outboundUrl = best.cand.url;
      c.thumbnailUrl = `https://img.youtube.com/vi/${best.cand.videoId}/hqdefault.jpg`;
      replaced++;
      matched.push({ id: c.id, brand: c.brand, title: c.title, youtube: best.cand.url, score: Number(best.s.toFixed(3)) });
      if (checked % 10 === 0) console.log(`progress ${checked}/${targets.length}, replaced=${replaced}`);
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, () => worker()));
  fs.writeFileSync(campaignsPath, JSON.stringify(campaigns, null, 2));
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), checked, replaced, matched, failed }, null, 2));
  console.log(`done checked=${checked} replaced=${replaced} report=${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
