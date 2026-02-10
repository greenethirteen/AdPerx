import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DATA_PATH = path.join(ROOT, "data", "campaigns.json");

const TOPIC_RULES = [
  { topic: "ai", re: /\b(ai|artificial intelligence|machine learning|chatgpt|gpt)\b/i },
  { topic: "food", re: /\b(food|burger|drink|beer|coke|cola|restaurant|pizza|chicken|mcdonald|kfc|taco|coffee)\b/i },
  { topic: "health", re: /\b(health|mental health|medical|hospital|disease|patient|cancer|vaccine|wellness|blood|period)\b/i },
  { topic: "technology", re: /\b(iphone|apple|android|tech|app|software|digital|internet|smartphone)\b/i },
  { topic: "music", re: /\b(music|song|audio|spotify|playlist|album|radio)\b/i },
  { topic: "women's rights", re: /\b(women|female|girl|femin|gender equality|sexism|misogyny)\b/i },
  { topic: "sports", re: /\b(sport|football|soccer|olympic|nba|nfl|fifa|tennis|cricket|athlete|stadium)\b/i },
  { topic: "education", re: /\b(education|school|student|learn|teacher|university|college|classroom)\b/i },
  { topic: "human rights", re: /\b(human rights|refugee|equality|justice|racism|inclusion|lgbt|disability|freedom)\b/i },
  { topic: "gaming", re: /\b(game|gaming|xbox|playstation|esports|gamer)\b/i },
  { topic: "sustainability", re: /\b(sustainab|climate|carbon|recycl|net[- ]?zero|environment|green|emission)\b/i },
  { topic: "privacy/security", re: /\b(privacy|security|cyber|scam|fraud|phishing|identity theft)\b/i }
];

const MAX_TOPICS = Number(process.env.MAX_TOPICS || 6);

function normalizeTopic(value) {
  return String(value || "").trim().toLowerCase();
}

const raw = fs.readFileSync(DATA_PATH, "utf8");
const campaigns = JSON.parse(raw);

let changed = 0;
let addedTotal = 0;
const topicCounts = {};

for (const c of campaigns) {
  const existing = Array.isArray(c.topics) ? c.topics.map(normalizeTopic).filter(Boolean) : [];
  const set = new Set(existing);
  const text = [
    c.title,
    c.brand,
    c.agency,
    c.notes,
    c.awardCategory,
    c.categoryBucket,
    ...(Array.isArray(c.formatHints) ? c.formatHints : []),
    ...(Array.isArray(c.topics) ? c.topics : [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  for (const rule of TOPIC_RULES) {
    if (set.size >= MAX_TOPICS) break;
    if (!set.has(rule.topic) && rule.re.test(text)) {
      set.add(rule.topic);
    }
  }

  const next = Array.from(set);
  if (next.length !== existing.length || next.some((v, i) => v !== existing[i])) {
    c.topics = next;
    changed += 1;
    addedTotal += Math.max(0, next.length - existing.length);
  }

  for (const t of next) topicCounts[t] = (topicCounts[t] || 0) + 1;
}

fs.writeFileSync(DATA_PATH, JSON.stringify(campaigns, null, 2));

const top10 = Object.entries(topicCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

console.log(`Updated topics for ${changed} campaigns; added ${addedTotal} topic tags.`);
console.log("Top 10 topics after enrichment:");
for (const [topic, n] of top10) {
  console.log(`${topic} ${n}`);
}
