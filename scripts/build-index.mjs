import fs from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";

/**
 * Builds a serialized MiniSearch index from data/campaigns.json
 * Output: data/index.json
 */
const root = process.cwd();
const campaignsPath = path.join(root, "data", "campaigns.json");
const enrichmentPath = path.join(root, "data", "campaign_enrichment.json");
const outPath = path.join(root, "data", "index.json");

if (!fs.existsSync(campaignsPath)) {
  console.error("Missing data/campaigns.json. Create it or copy from campaigns.sample.json.");
  process.exit(1);
}

const campaigns = JSON.parse(fs.readFileSync(campaignsPath, "utf-8"));
const enrichmentById = fs.existsSync(enrichmentPath)
  ? JSON.parse(fs.readFileSync(enrichmentPath, "utf-8"))
  : {};

function buildEnrichmentText(c) {
  const e = c.enrichment;
  if (!e) return "";
  return [
    e.summary,
    e.objective,
    e.insight,
    e.execution,
    e.impact,
    e.releaseDate,
    e.region,
    e.language,
    e.sourceNotes,
    ...(e.channels ?? []),
    ...(e.keywords ?? [])
  ]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

const mini = new MiniSearch({
  fields: [
    "title",
    "brand",
    "agency",
    "notes",
    "topics",
    "industry",
    "formatHints",
    "awardTier",
    "awardCategory",
    "categoryBucket",
    "enrichmentText"
  ],
  storeFields: [
    "id",
    "title",
    "brand",
    "agency",
    "year",
    "sourceUrl",
    "outboundUrl",
    "thumbnailUrl",
    "awardTier",
    "awardCategory",
    "categoryBucket",
    "topics",
    "industry",
    "formatHints",
    "notes",
    "enrichment",
    "enrichmentText"
  ],
  searchOptions: { boost: { title: 3, brand: 2, agency: 1.5 }, fuzzy: 0.2 }
});

// Ensure arrays exist
for (const c of campaigns) {
  const enrich = enrichmentById[c.id];
  if (enrich) c.enrichment = { ...(c.enrichment ?? {}), ...enrich };
  c.topics ??= [];
  c.formatHints ??= [];
  c.industry ??= "";
  c.notes ??= "";
  c.enrichmentText = buildEnrichmentText(c);
}
mini.addAll(campaigns);

const serialized = mini.toJSON();
fs.writeFileSync(outPath, JSON.stringify(serialized), "utf-8");
console.log(`✅ Wrote ${outPath} with ${campaigns.length} records`);
