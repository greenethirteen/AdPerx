import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const campaignsPath = path.join(root, "data", "campaigns.json");
const outCsv = path.join(root, "data", "superbowl_remaining_ispot_manual_review.csv");

const STOP = new Set([
  "the","and","for","with","from","super","bowl","big","game","tv","spot","promo","teaser","official","commercial","ad","feat","featuring","song","by","extended","full"
]);

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokens = (s) => norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w));

function parseYtInitialData(html) {
  const m = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function extractVideos(data, max = 8) {
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
      out.push({
        videoId: vr.videoId,
        title,
        channel,
        url: `https://www.youtube.com/watch?v=${vr.videoId}`
      });
      if (out.length >= max) return;
    }
    for (const k of Object.keys(n)) walk(n[k]);
  }
  walk(data);
  return out;
}

async function ytSearch(query) {
  const url = `https://www.youtube.com/results?hl=en&gl=US&search_query=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return [];
    const html = await res.text();
    const data = parseYtInitialData(html);
    if (!data) return [];
    return extractVideos(data, 8);
  } catch {
    return [];
  }
}

function score(campaign, cand) {
  const a = new Set(tokens(`${campaign.brand || ""} ${campaign.title || ""}`));
  const b = new Set(tokens(`${cand.title || ""} ${cand.channel || ""}`));
  let inter = 0;
  for (const v of a) if (b.has(v)) inter += 1;
  const uni = new Set([...a, ...b]).size || 1;
  let s = inter / uni;
  const bn = norm(campaign.brand || "").split(" ")[0] || "";
  const tn = norm(campaign.title || "");
  const vn = norm(cand.title || "");
  if (bn && vn.includes(bn)) s += 0.2;
  if (tn && (vn.includes(tn) || tn.includes(vn))) s += 0.18;
  if (/super bowl|superbowl|big game/.test(vn)) s += 0.08;
  if (campaign.year && vn.includes(String(campaign.year))) s += 0.05;
  if (/reaction|compilation|ranking|highlights|explained/.test(vn)) s -= 0.2;
  return Number(s.toFixed(3));
}

function csvEscape(v) {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function isIspot(url) {
  try {
    const h = new URL(url || "").hostname.toLowerCase();
    return h === "ispot.tv" || h.endsWith(".ispot.tv");
  } catch {
    return false;
  }
}

async function main() {
  const campaigns = JSON.parse(fs.readFileSync(campaignsPath, "utf8"));
  const targets = campaigns.filter(
    (c) => (c.topics || []).some((t) => String(t).toLowerCase() === "super bowl") && isIspot(c.outboundUrl)
  );

  const header = [
    "id","year","brand","title","current_outbound","source_url","youtube_search",
    "cand1_score","cand1_title","cand1_url",
    "cand2_score","cand2_title","cand2_url",
    "cand3_score","cand3_title","cand3_url"
  ];
  const rows = [header.join(",")];

  let i = 0;
  for (const c of targets) {
    i += 1;
    const q = `${c.brand || ""} ${c.title || ""} super bowl ${c.year || ""} ad`.replace(/\s+/g, " ").trim();
    const results = await ytSearch(q);
    const scored = results
      .map((r) => ({ ...r, score: score(c, r) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    const line = [
      c.id,
      c.year || "",
      c.brand || "",
      c.title || "",
      c.outboundUrl || "",
      c.sourceUrl || "",
      `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`,
      scored[0]?.score ?? "",
      scored[0]?.title ?? "",
      scored[0]?.url ?? "",
      scored[1]?.score ?? "",
      scored[1]?.title ?? "",
      scored[1]?.url ?? "",
      scored[2]?.score ?? "",
      scored[2]?.title ?? "",
      scored[2]?.url ?? ""
    ].map(csvEscape).join(",");
    rows.push(line);

    if (i % 20 === 0) console.log(`progress ${i}/${targets.length}`);
  }

  fs.writeFileSync(outCsv, rows.join("\n"));
  console.log(`wrote ${outCsv} (${targets.length} rows)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

