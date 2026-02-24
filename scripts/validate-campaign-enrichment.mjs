import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const campaignsPath = path.join(root, "data", "campaigns.json");
const enrichmentPath = path.join(root, "data", "campaign_enrichment.json");

if (!fs.existsSync(campaignsPath) || !fs.existsSync(enrichmentPath)) {
  console.error("Missing data/campaigns.json or data/campaign_enrichment.json");
  process.exit(1);
}

const campaigns = JSON.parse(fs.readFileSync(campaignsPath, "utf8"));
const enrichment = JSON.parse(fs.readFileSync(enrichmentPath, "utf8"));

const ids = new Set(campaigns.map((c) => c.id));
const unknown = Object.keys(enrichment).filter((id) => !ids.has(id));

const withSummary = Object.values(enrichment).filter((e) => String(e?.summary ?? "").trim()).length;

console.log(
  JSON.stringify(
    {
      campaigns: campaigns.length,
      enrichmentEntries: Object.keys(enrichment).length,
      withSummary,
      unknownIds: unknown.length
    },
    null,
    2
  )
);

if (unknown.length) {
  console.log("\nUnknown enrichment ids:");
  for (const id of unknown.slice(0, 50)) console.log(id);
  process.exit(2);
}
