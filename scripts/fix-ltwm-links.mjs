import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataPath = path.join(root, "data", "campaigns.json");

if (!fs.existsSync(dataPath)) {
  console.error("Missing data/campaigns.json");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
let updated = 0;

function buildFragment(title, brand) {
  const t = `${title} – ${brand}`.replace(/\s+/g, " ").trim();
  return `#:~:text=${encodeURIComponent(t)}`;
}

for (const r of data) {
  if (!r.sourceUrl || !r.title || !r.brand) continue;
  if (r.sourceUrl.includes("#:~:text=")) continue;
  const frag = buildFragment(r.title, r.brand);
  r.sourceUrl = `${r.sourceUrl.replace(/#.*$/, "")}${frag}`;
  updated += 1;
}

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), "utf-8");
console.log(`✅ Updated ${updated} sourceUrl entries with text fragments`);
