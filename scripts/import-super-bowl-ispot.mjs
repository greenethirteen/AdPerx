import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const campaignsPath = path.join(root, "data", "campaigns.json");

const START_YEAR = Number(process.env.START_YEAR ?? "2016");
const END_YEAR = Number(process.env.END_YEAR ?? "2025");

function uniq(arr) {
  return [...new Set((arr ?? []).filter(Boolean).map((v) => String(v).trim()).filter(Boolean))];
}

function ensureTopic(c, topic) {
  c.topics = uniq([...(c.topics ?? []), topic]);
}

function ensureFormat(c, hint) {
  c.formatHints = uniq([...(c.formatHints ?? []), hint]);
}

function titleCaseSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function parsePlaylistName(name) {
  if (!name) return { brand: "", title: "" };
  const idx = name.indexOf(":");
  if (idx <= 0) return { brand: "", title: name.trim() };
  return {
    brand: name.slice(0, idx).trim(),
    title: name.slice(idx + 1).trim()
  };
}

function makeId(year, adId) {
  return `super-bowl-${year}-ispot-${String(adId).toLowerCase()}`;
}

function extractAdId(adPath) {
  const parts = adPath.split("/").filter(Boolean);
  return parts[1] ?? "";
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function parseYearPage(html) {
  const items = [];
  const re = /<a href="(\/ad\/[^"]+)"[\s\S]*?data-playlist-item[\s\S]*?data-playlist-name="([^"]+)"[\s\S]*?data-playlist-image="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    items.push({
      adPath: m[1],
      playlistName: m[2].trim(),
      image: m[3].trim()
    });
  }
  // Dedup by adPath
  const seen = new Set();
  return items.filter((it) => {
    if (seen.has(it.adPath)) return false;
    seen.add(it.adPath);
    return true;
  });
}

async function main() {
  if (!fs.existsSync(campaignsPath)) {
    console.error("Missing data/campaigns.json");
    process.exit(1);
  }

  const campaigns = JSON.parse(fs.readFileSync(campaignsPath, "utf-8"));
  const byOutbound = new Map();
  const byId = new Map();
  for (const c of campaigns) {
    if (c.outboundUrl) byOutbound.set(c.outboundUrl, c);
    byId.set(c.id, c);
  }

  let scanned = 0;
  let added = 0;
  let updated = 0;
  let failedYears = 0;

  for (let year = START_YEAR; year <= END_YEAR; year++) {
    const yearUrl = `https://www.ispot.tv/events/${year}-super-bowl-commercials`;
    let html = "";
    try {
      html = await fetchText(yearUrl);
    } catch (err) {
      failedYears++;
      console.warn(`warn: unable to fetch ${year}: ${err.message}`);
      continue;
    }
    const rows = parseYearPage(html);
    scanned += rows.length;

    for (const row of rows) {
      const adUrl = `https://www.ispot.tv${row.adPath}`;
      const adId = extractAdId(row.adPath);
      const slug = row.adPath.split("/").filter(Boolean)[2] ?? "";
      const parsed = parsePlaylistName(row.playlistName);
      const brand = parsed.brand || "Unknown Brand";
      const title = parsed.title || titleCaseSlug(slug) || `Super Bowl Ad ${year}`;
      const candidateId = makeId(year, adId || slug || Math.random().toString(36).slice(2, 8));

      const existing = byOutbound.get(adUrl) || byId.get(candidateId);
      if (existing) {
        ensureTopic(existing, "super bowl");
        ensureTopic(existing, "sports");
        ensureFormat(existing, "film");
        existing.awardTier = existing.awardTier || "Super Bowl";
        existing.categoryBucket = existing.categoryBucket || "Super Bowl";
        existing.awardCategory = existing.awardCategory || "Super Bowl Ads";
        existing.year = existing.year || year;
        existing.industry = existing.industry || "sports";
        existing.thumbnailUrl = existing.thumbnailUrl || row.image;
        existing.outboundUrl = existing.outboundUrl || adUrl;
        existing.sourceUrl = existing.sourceUrl || yearUrl;
        updated++;
        continue;
      }

      const rec = {
        id: candidateId,
        title,
        brand,
        agency: "",
        year,
        sourceUrl: yearUrl,
        outboundUrl: adUrl,
        thumbnailUrl: row.image,
        awardTier: "Super Bowl",
        awardCategory: "Super Bowl Ads",
        categoryBucket: "Super Bowl",
        formatHints: ["film"],
        topics: ["super bowl", "sports"],
        industry: "sports",
        notes: `Imported from iSpot ${year} Super Bowl commercials.`
      };
      campaigns.push(rec);
      byOutbound.set(adUrl, rec);
      byId.set(rec.id, rec);
      added++;
    }

    console.log(`year ${year}: ${rows.length} ads parsed`);
  }

  // Tag existing records that clearly mention Super Bowl.
  let taggedExisting = 0;
  for (const c of campaigns) {
    const blob = `${c.title || ""} ${c.notes || ""} ${c.outboundUrl || ""}`.toLowerCase();
    if (blob.includes("super bowl") || blob.includes("superbowl") || blob.includes("big game")) {
      const before = (c.topics ?? []).length;
      ensureTopic(c, "super bowl");
      ensureTopic(c, "sports");
      ensureFormat(c, "film");
      c.industry = c.industry || "sports";
      if ((c.topics ?? []).length > before) taggedExisting++;
    }
  }

  fs.writeFileSync(campaignsPath, JSON.stringify(campaigns, null, 2));
  console.log(
    `done: scanned=${scanned}, added=${added}, updated=${updated}, taggedExisting=${taggedExisting}, failedYears=${failedYears}, total=${campaigns.length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

