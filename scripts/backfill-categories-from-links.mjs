import fs from "node:fs";
import path from "node:path";

const FILE = path.join(process.cwd(), "data", "campaigns.json");

function clean(s) {
  return String(s || "").trim();
}

function normalizeCategory(raw) {
  const t = clean(raw).toLowerCase();
  if (!t) return "";

  if (/(film[\s/-]*craft|craft[\s/-]*film|film-technique)/.test(t)) return "Film Craft";
  if (/(print|publishing|press)/.test(t)) return "Print";
  if (/(radio|audio|podcast)/.test(t)) return "Radio/Audio";
  if (/(outdoor|ooh)/.test(t)) return "Outdoor";
  if (/(digital[\s/-]*craft)/.test(t)) return "Digital Craft";
  if (/(digital|mobile|interactive|web|online)/.test(t)) return "Digital";
  if (/(design|product[\s/-]*design|packaging)/.test(t)) return "Design";
  if (/(public[\s/-]*relations|\bpr\b)/.test(t)) return "PR";
  if (/(direct)/.test(t)) return "Direct";
  if (/(media)/.test(t)) return "Media";
  if (/(social|influencer|creator)/.test(t)) return "Social/Influencer";
  if (/(health|pharma|wellness|healthcare)/.test(t)) return "Health";
  if (/(innovation)/.test(t)) return "Innovation";
  if (/(data)/.test(t)) return "Data";
  if (/(brand[\s/&-]*experience|activation|experiential)/.test(t)) return "Brand Experience";
  if (/(entertainment|gaming|music|sport)/.test(t)) return "Entertainment";
  if (/(commerce|shopper|retail)/.test(t)) return "Commerce";
  if (/(good|sdg|sustainable|sustainability|for-good)/.test(t)) return "Good/SDG";
  if (/\bfilm\b/.test(t)) return "Film";
  if (/(craft|industry[\s/-]*craft)/.test(t)) return "Craft";
  return "Other";
}

function fromDandad(u) {
  // /awards/professional/2018/integrated/27204/...
  const m = u.pathname.match(/\/awards\/professional\/\d{4}\/([^/]+)\//i);
  if (!m) return "";
  return m[1].replace(/-/g, " ");
}

function fromClios(u) {
  // /awards/winner/public-relations/...
  // /health/winner/digital/...
  // /sports/winner/public-relations/...
  let m = u.pathname.match(/\/awards\/winner\/([^/]+)\//i);
  if (m) return m[1].replace(/-/g, " ");
  m = u.pathname.match(/^\/(health|sports|music|entertainment)\/winner\/([^/]+)\//i);
  if (m) return `${m[1]} ${m[2]}`.replace(/-/g, " ");
  return "";
}

function fromAdspot(u) {
  // /media/prints/... /media/tv-commercials/...
  const m = u.pathname.match(/\/media\/([^/]+)\//i);
  if (!m) return "";
  const token = m[1].toLowerCase();
  if (token.includes("print")) return "print";
  if (token.includes("tv") || token.includes("video")) return "film";
  if (token.includes("radio") || token.includes("audio")) return "radio audio";
  if (token.includes("outdoor")) return "outdoor";
  if (token.includes("digital")) return "digital";
  return token.replace(/-/g, " ");
}

function fromSpikesEurobest(u) {
  // /winners/2018/promo/entry.cfm...
  const m = u.pathname.match(/\/winners\/\d{4}\/([^/]+)\//i);
  if (!m) return "";
  const token = m[1].toLowerCase();
  const map = {
    promo: "brand experience activation",
    branded_content: "entertainment",
    media: "media",
    direct: "direct",
    digital: "digital",
    design: "design",
    print: "print",
    print_craft: "print",
    outdoor: "outdoor",
    film: "film",
    film_craft: "film craft",
    radio: "radio audio",
    mobile: "digital",
    integrated: "brand experience activation",
    innovation: "innovation",
    pr: "public relations",
    healthcare: "health",
    pharma: "pharma",
    brand_experience: "brand experience activation",
  };
  return map[token] || token.replace(/_/g, " ");
}

function inferCategoryFromUrl(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();

    if (host.endsWith("dandad.org")) return fromDandad(u);
    if (host.endsWith("clios.com")) return fromClios(u);
    if (host.endsWith("adsspot.me")) return fromAdspot(u);
    if (host.endsWith("spikes.asia") || host.endsWith("eurobest.com")) return fromSpikesEurobest(u);
    if (host.endsWith("adforum.com")) {
      const p = u.pathname.toLowerCase();
      if (p.includes("/film/") || p.includes("/player/")) return "film";
      if (p.includes("/print/")) return "print";
      if (p.includes("/radio/")) return "radio audio";
      if (p.includes("/outdoor/")) return "outdoor";
    }

    // Conservative fallback heuristics from media URL type.
    if (
      host === "youtube.com" ||
      host === "youtu.be" ||
      host.endsWith(".youtube.com") ||
      host === "vimeo.com" ||
      host.endsWith(".vimeo.com") ||
      host === "vimeopro.com"
    ) {
      return "film";
    }
    if (host.endsWith("behance.net") || host.endsWith("pinterest.com")) return "design";

    const p = u.pathname.toLowerCase();
    if (/\.(mp4|mov|m4v|webm)$/i.test(p) || p.includes("/video")) return "film";
    if (/\.(jpg|jpeg|png|webp|gif|bmp|avif)$/i.test(p)) return "print";
  } catch {
    return "";
  }
  return "";
}

function main() {
  if (!fs.existsSync(FILE)) {
    console.error(`Missing file: ${FILE}`);
    process.exit(1);
  }

  const rows = JSON.parse(fs.readFileSync(FILE, "utf8"));
  let scanned = 0;
  let updated = 0;
  let setAwardCategory = 0;
  let setCategoryBucket = 0;

  for (const r of rows) {
    const hasCat = clean(r.categoryBucket);
    const hasAwardCat = clean(r.awardCategory);
    if (hasCat && hasAwardCat) continue;

    scanned += 1;
    const inferredRaw =
      inferCategoryFromUrl(clean(r.outboundUrl)) ||
      inferCategoryFromUrl(clean(r.sourceUrl));
    if (!inferredRaw) continue;

    const inferredBucket = normalizeCategory(inferredRaw);
    let changed = false;

    if (!hasAwardCat) {
      r.awardCategory = inferredRaw.toUpperCase();
      setAwardCategory += 1;
      changed = true;
    }
    if (!hasCat && inferredBucket) {
      r.categoryBucket = inferredBucket;
      setCategoryBucket += 1;
      changed = true;
    }
    if (changed) updated += 1;
  }

  fs.writeFileSync(FILE, JSON.stringify(rows, null, 2), "utf8");

  const withCategory = rows.filter((r) => clean(r.categoryBucket)).length;
  const missingCategory = rows.length - withCategory;
  const byCat = {};
  for (const r of rows) {
    const k = clean(r.categoryBucket);
    if (!k) continue;
    byCat[k] = (byCat[k] || 0) + 1;
  }
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 20);

  console.log(`Scanned missing rows: ${scanned}`);
  console.log(`Updated rows: ${updated}`);
  console.log(`Set awardCategory: ${setAwardCategory}`);
  console.log(`Set categoryBucket: ${setCategoryBucket}`);
  console.log(`With categoryBucket: ${withCategory}/${rows.length} (missing ${missingCategory})`);
  console.log("Top categories:");
  for (const [k, v] of top) console.log(`- ${k}: ${v}`);
}

main();
