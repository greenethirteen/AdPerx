import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dataPath = path.join(root, "data", "campaigns.json");
const outPath = path.join(root, "data", "dead_links.json");
const progressPath = path.join(root, "data", "dead_links.progress.json");

const MAX_CHECKS = Number(process.env.MAX_CHECKS ?? "0"); // 0 = all
const RESUME = process.env.RESUME !== "0";
const CHECKPOINT_EVERY = Number(process.env.CHECKPOINT_EVERY ?? "25");
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? "12000");

if (!fs.existsSync(dataPath)) {
  console.error("Missing data/campaigns.json");
  process.exit(1);
}

function loadJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fallback;
  }
}

function saveCheckpoint(nextIndex, checked, dead) {
  fs.writeFileSync(
    progressPath,
    JSON.stringify(
      {
        updatedAt: new Date().toISOString(),
        nextIndex,
        checked,
        deadCount: dead.length
      },
      null,
      2
    ),
    "utf-8"
  );
  fs.writeFileSync(outPath, JSON.stringify(dead, null, 2), "utf-8");
}

async function fetchStatus(url, method) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "AdPerxBot/0.1 (metadata indexer)"
      }
    });
    return res.status || 0;
  } catch {
    return 0;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkUrl(url) {
  const headStatus = await fetchStatus(url, "HEAD");
  if (headStatus && headStatus < 400) return { status: headStatus, ok: true };
  const getStatus = await fetchStatus(url, "GET");
  if (getStatus && getStatus < 400) return { status: getStatus, ok: true };
  return { status: getStatus || headStatus || 0, ok: false };
}

const data = JSON.parse(fs.readFileSync(dataPath, "utf-8"));
const urls = data
  .filter((x) => x.outboundUrl)
  .map((x) => ({ id: x.id, url: x.outboundUrl, title: x.title, brand: x.brand, year: x.year }));

const priorDead = loadJson(outPath, []);
const progress = RESUME ? loadJson(progressPath, null) : null;
const startIndex = progress?.nextIndex && Number.isFinite(progress.nextIndex) ? Number(progress.nextIndex) : 0;
const dead = Array.isArray(priorDead) ? priorDead : [];
const deadKeys = new Set(dead.map((x) => `${x.id}::${x.url}`));
let checked = progress?.checked && Number.isFinite(progress.checked) ? Number(progress.checked) : 0;
const targetIndexExclusive = MAX_CHECKS > 0 ? Math.min(urls.length, startIndex + MAX_CHECKS) : urls.length;
let lastLog = Date.now();
let sinceCheckpoint = 0;

for (let i = startIndex; i < targetIndexExclusive; i += 1) {
  const item = urls[i];
  checked += 1;
  sinceCheckpoint += 1;
  const res = await checkUrl(item.url);
  if (!res.ok) {
    const key = `${item.id}::${item.url}`;
    if (!deadKeys.has(key)) {
      dead.push({ ...item, status: res.status });
      deadKeys.add(key);
    }
  }
  if (Date.now() - lastLog > 2000) {
    console.log(`Checked ${i + 1}/${urls.length} | Dead ${dead.length}`);
    lastLog = Date.now();
  }
  if (sinceCheckpoint >= CHECKPOINT_EVERY) {
    saveCheckpoint(i + 1, checked, dead);
    sinceCheckpoint = 0;
  }
}

saveCheckpoint(targetIndexExclusive, checked, dead);
if (targetIndexExclusive >= urls.length && fs.existsSync(progressPath)) {
  fs.unlinkSync(progressPath);
}
console.log(`✅ Done. Checked ${checked}. Dead ${dead.length}. Wrote ${outPath}`);
