import fs from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";

/**
 * Builds a serialized MiniSearch index from data/campaigns.json
 * Output: data/index.json
 */
const root = process.cwd();
const campaignsPath = path.join(root, "data", "campaigns.json");
const outPath = path.join(root, "data", "index.json");

if (!fs.existsSync(campaignsPath)) {
  console.error("Missing data/campaigns.json. Create it or copy from campaigns.sample.json.");
  process.exit(1);
}

const campaigns = JSON.parse(fs.readFileSync(campaignsPath, "utf-8"));

const mini = new MiniSearch({
  fields: ["title", "brand", "agency", "notes", "topics", "industry", "formatHints", "awardTier", "awardCategory", "categoryBucket"],
  storeFields: ["id", "title", "brand", "agency", "year", "sourceUrl", "outboundUrl", "thumbnailUrl", "awardTier", "awardCategory", "categoryBucket", "topics", "industry", "formatHints", "notes"],
  searchOptions: { boost: { title: 3, brand: 2, agency: 1.5 }, fuzzy: 0.2 }
});

// Ensure arrays exist
for (const c of campaigns) {
  c.topics ??= [];
  c.formatHints ??= [];
  c.industry ??= "";
  c.notes ??= "";
}
mini.addAll(campaigns);

const serialized = mini.toJSON();
fs.writeFileSync(outPath, JSON.stringify(serialized), "utf-8");
console.log(`✅ Wrote ${outPath} with ${campaigns.length} records`);
