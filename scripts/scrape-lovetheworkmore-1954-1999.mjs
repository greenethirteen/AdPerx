import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const SOURCE_URL = "https://lovetheworkmore.com/1954-1999/";
const OUT = path.join(process.cwd(), "data", "campaigns.json");

function norm(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim();
}

function decodeHtml(s) {
  return String(s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function slugify(s) {
  return norm(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function absolute(href) {
  try {
    return new URL(href, SOURCE_URL).toString();
  } catch {
    return "";
  }
}

function quickThumb(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `https://img.youtube.com/vi/${v}/hqdefault.jpg`;
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace("/", "");
      if (id) return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
    }
    if (u.hostname.includes("vimeo.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      const id = parts.find((p) => /^\d+$/.test(p));
      if (id) return `https://vumbnail.com/${id}.jpg`;
    }
  } catch {
    return "";
  }
  return "";
}

function parseLine(raw) {
  // Expected shape:
  // 1977 – TITLE – BRAND (AGENCY)
  const text = norm(raw)
    .replace(/&#8211;|&ndash;/gi, " – ")
    .replace(/&#8217;/gi, "'")
    .replace(/\u2013/g, " – ");

  const yearMatch = text.match(/^(19\d{2})\s*[–-]\s*/);
  if (!yearMatch) return null;
  const year = Number(yearMatch[1]);
  let tail = norm(text.slice(yearMatch[0].length));

  // Split first separator as title boundary, second as brand boundary.
  const sep = /\s+[–-]\s+/;
  const first = tail.split(sep);
  if (first.length < 2) return null;
  const title = norm(first[0]);
  const rest = norm(first.slice(1).join(" – "));
  if (!title || !rest) return null;

  const agencyMatch = rest.match(/\(([^)]+)\)\s*$/);
  const agency = agencyMatch ? norm(agencyMatch[1]) : "";
  const brand = norm(rest.replace(/\s*\([^)]+\)\s*$/, ""));
  if (!brand) return null;

  return { year, title, brand, agency };
}

async function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "user-agent": "Mozilla/5.0" } },
      (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          res.resume();
          return;
        }
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );
    req.on("error", reject);
  });
}

function dedupeById(records) {
  const m = new Map();
  for (const r of records) m.set(r.id, r);
  return [...m.values()];
}

async function main() {
  const html = await fetchHtml(SOURCE_URL);

  const parsed = [];
  const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = absolute(decodeHtml(m[1] || ""));
    if (!href) continue;
    const text = norm(decodeHtml((m[2] || "").replace(/<[^>]+>/g, " ")));
    if (!text || !/^19\d{2}/.test(text)) continue;

    const row = parseLine(text);
    if (!row) continue;

    const id = `${row.year}-${slugify(row.title)}-${slugify(row.brand)}`.slice(0, 120);
    parsed.push({
      id,
      title: row.title,
      brand: row.brand,
      agency: row.agency,
      year: row.year,
      sourceUrl: SOURCE_URL,
      outboundUrl: href,
      thumbnailUrl: quickThumb(href),
      awardTier: "",
      awardCategory: "Classic Archive",
      categoryBucket: "Film",
      formatHints: ["film"],
      topics: [],
      industry: "",
      notes: ""
    });
  }

  const extracted = dedupeById(parsed).filter((r) => r.year >= 1954 && r.year <= 1999);
  if (!extracted.length) {
    console.log("No records extracted.");
    return;
  }

  const existing = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf-8")) : [];
  const byId = new Map(existing.map((x) => [x.id, x]));
  let added = 0;
  let merged = 0;

  for (const r of extracted) {
    const prev = byId.get(r.id);
    if (!prev) {
      byId.set(r.id, r);
      added += 1;
      continue;
    }
    byId.set(r.id, {
      ...prev,
      ...r,
      // keep existing enrichments if present
      thumbnailUrl: prev.thumbnailUrl || r.thumbnailUrl || "",
      outboundUrl: prev.outboundUrl || r.outboundUrl || "",
      notes: prev.notes || r.notes || ""
    });
    merged += 1;
  }

  const out = [...byId.values()].sort((a, b) => (Number(b.year || 0) - Number(a.year || 0)));
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2), "utf-8");
  console.log(`Extracted: ${extracted.length}`);
  console.log(`Added: ${added}, merged(existing): ${merged}`);
  console.log(`✅ Wrote ${OUT} with ${out.length} records`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
