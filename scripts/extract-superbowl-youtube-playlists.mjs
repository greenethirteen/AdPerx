import fs from "node:fs";
import path from "node:path";

const PLAYLISTS = [
  { year: 2025, listId: "PLCeYpRAW8EfqOdmUc9Z0QIFT4mCuDUEYB", label: "2025 Ads of Super Bowl LIX (59)" },
  { year: 2024, listId: "PLCeYpRAW8EfpJYj_eBbVXm371ZojxWA_E", label: "2024 Ads of Super Bowl LVIII (58)" },
  { year: 2023, listId: "PLLF5BHcPOPUmz1MBeceJloeTfrU_QZF77", label: "All the 2023 Super Bowl commercials" },
  { year: 2022, listId: "PLCeYpRAW8Efo7J1h2UHde-87B9JNyBUXM", label: "2022 Ads of Super Bowl LVI (56)" },
  { year: 2021, listId: "PLLF5BHcPOPUkYlRxhCpg52GskassQUDqF", label: "All the 2021 Super Bowl commercials" },
  { year: 2020, listId: "PLOKnlVLuXE5VJkRFz15ZyfXOgYMoDEmSf", label: "2020 Super Bowl Ads" },
  { year: 2019, listId: "PLCeYpRAW8EfqBeV08isxbRrvCtuaqHniz", label: "2019 Ads of Superbowl LIII (53)" },
  { year: 2018, listId: "PLCeYpRAW8EfpVWAZ_-_2SR6Fl_go-1Os5", label: "2018 Ads of Super Bowl LII (52)" },
  { year: 2017, listId: "PLCeYpRAW8EfrjRT-1ZlcjhotXlDcHLHSm", label: "2017 Ads of Super Bowl LI (51)" },
  { year: 2016, listId: "PLCeYpRAW8EfrAakeKaCO8wUCfS50pKYAw", label: "2016 Ads of Super Bowl L (50)" }
];

const root = process.cwd();
const outPath = path.join(root, "data", "superbowl_youtube_links.json");

function getYtInitialData(html) {
  const match = html.match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractVideosFromInitialData(data) {
  const videos = [];
  const seen = new Set();

  function walk(node) {
    if (!node || typeof node !== "object") return;

    const pvr = node.playlistVideoRenderer;
    if (pvr?.videoId && !seen.has(pvr.videoId)) {
      seen.add(pvr.videoId);
      const title =
        pvr.title?.runs?.map((r) => r.text).join("") ||
        pvr.title?.simpleText ||
        "";
      videos.push({
        videoId: pvr.videoId,
        title,
        url: `https://www.youtube.com/watch?v=${pvr.videoId}`
      });
    }

    if (Array.isArray(node)) {
      for (const x of node) walk(x);
      return;
    }
    for (const k of Object.keys(node)) walk(node[k]);
  }

  walk(data);
  return videos;
}

async function fetchPlaylist(listId) {
  const url = `https://www.youtube.com/playlist?list=${listId}`;
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" }
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const html = await res.text();
  const data = getYtInitialData(html);
  if (!data) throw new Error(`Unable to parse ytInitialData for ${listId}`);
  return extractVideosFromInitialData(data);
}

async function main() {
  const result = {
    generatedAt: new Date().toISOString(),
    source: "YouTube playlist pages",
    playlists: []
  };

  let total = 0;
  for (const p of PLAYLISTS) {
    try {
      const videos = await fetchPlaylist(p.listId);
      total += videos.length;
      result.playlists.push({
        year: p.year,
        label: p.label,
        listId: p.listId,
        playlistUrl: `https://www.youtube.com/playlist?list=${p.listId}`,
        count: videos.length,
        videos
      });
      console.log(`year ${p.year}: ${videos.length} videos`);
    } catch (err) {
      result.playlists.push({
        year: p.year,
        label: p.label,
        listId: p.listId,
        playlistUrl: `https://www.youtube.com/playlist?list=${p.listId}`,
        count: 0,
        error: String(err)
      });
      console.warn(`year ${p.year}: failed (${err.message})`);
    }
  }

  result.totalVideos = total;
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`wrote ${outPath} (${total} video links)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

