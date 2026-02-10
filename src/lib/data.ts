import fs from "node:fs";
import path from "node:path";
import MiniSearch from "minisearch";
import type { Campaign } from "./types";

type Cache = {
  campaigns: Campaign[];
  mini: MiniSearch<Campaign>;
  campaignsMtime: number;
  indexMtime: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __adperxCache: Cache | undefined;
}

function readJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf-8")) as T;
}

function buildMini(campaigns: Campaign[]) {
  const mini = new MiniSearch<Campaign>({
    fields: ["title", "brand", "agency", "notes", "topics", "industry", "formatHints", "awardTier", "awardCategory", "categoryBucket"],
    storeFields: ["id", "title", "brand", "agency", "year", "sourceUrl", "outboundUrl", "thumbnailUrl", "awardTier", "awardCategory", "categoryBucket", "topics", "industry", "formatHints", "notes"],
    searchOptions: { boost: { title: 3, brand: 2, agency: 1.5 }, fuzzy: 0.2 }
  });
  for (const c of campaigns) {
    c.topics ??= [];
    c.formatHints ??= [];
    c.industry ??= "";
    c.notes ??= "";
  }
  mini.addAll(campaigns);
  return mini;
}

export function getData(): Cache {
  const root = process.cwd();
  const campaignsPath = path.join(root, "data", "campaigns.json");
  const indexPath = path.join(root, "data", "index.json");

  const campaignsMtime = fs.existsSync(campaignsPath) ? fs.statSync(campaignsPath).mtimeMs : 0;
  const indexMtime = fs.existsSync(indexPath) ? fs.statSync(indexPath).mtimeMs : 0;

  if (
    globalThis.__adperxCache &&
    globalThis.__adperxCache.campaignsMtime === campaignsMtime &&
    globalThis.__adperxCache.indexMtime === indexMtime
  ) {
    return globalThis.__adperxCache;
  }

  const campaigns = fs.existsSync(campaignsPath)
    ? readJson<Campaign[]>(campaignsPath)
    : readJson<Campaign[]>(path.join(root, "data", "campaigns.sample.json"));

  let mini: MiniSearch<Campaign>;
  if (fs.existsSync(indexPath)) {
    const serialized = readJson<any>(indexPath);
    try {
      mini = MiniSearch.loadJS<Campaign>(serialized, {
        fields: ["title", "brand", "agency", "notes", "topics", "industry", "formatHints", "awardTier", "awardCategory", "categoryBucket"],
        storeFields: ["id", "title", "brand", "agency", "year", "sourceUrl", "outboundUrl", "thumbnailUrl", "awardTier", "awardCategory", "categoryBucket", "topics", "industry", "formatHints", "notes"]
      });
    } catch {
      mini = buildMini(campaigns);
    }
  } else {
    mini = buildMini(campaigns);
  }

  globalThis.__adperxCache = { campaigns, mini, campaignsMtime, indexMtime };
  return globalThis.__adperxCache;
}
