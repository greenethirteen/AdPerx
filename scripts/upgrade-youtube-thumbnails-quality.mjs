import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";

const DATA_PATH = path.resolve("data/campaigns.json");
const CONCURRENCY = Number(process.env.CONCURRENCY || "16");
const TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || "9000");

function clean(raw) {
  return String(raw || "").replace(/&amp;/g, "&").trim();
}

function extractYoutubeId(url) {
  const raw = clean(url);
  if (!raw) return "";
  let m = raw.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (!m) m = raw.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (!m) m = raw.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/);
  if (!m) m = raw.match(/\/embed\/([A-Za-z0-9_-]{11})/);
  if (!m) m = raw.match(/\/vi\/([A-Za-z0-9_-]{11})\//);
  return m ? m[1] : "";
}

function buildCandidates(id) {
  return [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/default.jpg`,
  ];
}

function requestUrl(url, method = "HEAD") {
  return new Promise((resolve) => {
    let timedOut = false;
    try {
      const u = new URL(url);
      const lib = u.protocol === "https:" ? https : http;
      const req = lib.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port,
          path: `${u.pathname}${u.search}`,
          method,
          headers: {
            "user-agent": "AdPerxBot/thumbnail-upgrade",
            accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          },
        },
        (res) => {
          const status = res.statusCode || 0;
          const contentType = String(res.headers["content-type"] || "");
          const contentLength = Number(res.headers["content-length"] || 0);
          res.resume();
          resolve({ ok: status >= 200 && status < 300, status, contentType, contentLength });
        }
      );
      req.setTimeout(TIMEOUT_MS, () => {
        timedOut = true;
        req.destroy();
      });
      req.on("error", () => resolve({ ok: false, status: timedOut ? 408 : 0, contentType: "", contentLength: 0 }));
      req.end();
    } catch {
      resolve({ ok: false, status: 0, contentType: "", contentLength: 0 });
    }
  });
}

async function checkImage(url) {
  // HEAD is usually enough for ytimg; fallback to GET if HEAD is blocked.
  let res = await requestUrl(url, "HEAD");
  if (!res.ok && (res.status === 405 || res.status === 403 || res.status === 0)) {
    res = await requestUrl(url, "GET");
  }
  if (!res.ok) return false;
  if (res.contentType && !res.contentType.toLowerCase().includes("image")) return false;
  return true;
}

async function bestThumbnailForId(id, cache) {
  if (cache.has(id)) return cache.get(id);
  const candidates = buildCandidates(id);
  let best = "";
  for (const c of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const ok = await checkImage(c);
    if (ok) {
      best = c;
      break;
    }
  }
  cache.set(id, best);
  return best;
}

async function runPool(items, worker, concurrency) {
  let i = 0;
  const workers = new Array(Math.max(1, concurrency)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      // eslint-disable-next-line no-await-in-loop
      await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

async function main() {
  if (!fs.existsSync(DATA_PATH)) {
    console.error(`Missing ${DATA_PATH}`);
    process.exit(1);
  }
  const data = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const cache = new Map();

  const targets = [];
  for (const r of data) {
    const yid = extractYoutubeId(r.outboundUrl) || extractYoutubeId(r.sourceUrl) || extractYoutubeId(r.thumbnailUrl);
    if (!yid) continue;
    targets.push({ rec: r, yid });
  }

  let checked = 0;
  let upgraded = 0;
  let unchanged = 0;
  let unresolved = 0;

  await runPool(
    targets,
    async ({ rec, yid }) => {
      const best = await bestThumbnailForId(yid, cache);
      checked += 1;
      if (!best) {
        unresolved += 1;
        return;
      }
      const prev = clean(rec.thumbnailUrl);
      if (prev !== best) {
        rec.thumbnailUrl = best;
        upgraded += 1;
      } else {
        unchanged += 1;
      }
      if (checked % 200 === 0) {
        console.log(`Progress: checked ${checked}/${targets.length}, upgraded ${upgraded}, unresolved ${unresolved}`);
      }
    },
    CONCURRENCY
  );

  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
  console.log(`Done: checked ${checked}, upgraded ${upgraded}, unchanged ${unchanged}, unresolved ${unresolved}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
