import type { Campaign } from "./types";

export type PatternClaim = {
  text: string;
  citations: string[];
};

export type Pattern = {
  id: string;
  title: string;
  summary: PatternClaim[];
  examples: Campaign[];
  signals: {
    formats: string[];
    topics: string[];
    industries: string[];
    years: number[];
  };
  confidence: {
    support: number;
    score: number;
    note?: string;
  };
};

const RECENT_YEAR = 2022;
const MIN_YEAR = 2016;

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function topKeys(map: Map<string, number>, n: number): string[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function topYears(map: Map<number, number>, n: number): number[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function awardRank(tier?: string) {
  const raw = (tier || "").toLowerCase();
  if (raw.includes("grand")) return 5;
  if (raw.includes("gold")) return 4;
  if (raw.includes("silver")) return 3;
  if (raw.includes("bronze")) return 2;
  if (raw.includes("short")) return 1;
  return 0;
}

function scoreExamples(items: Campaign[]) {
  return [...items].sort((a, b) => {
    const ar = awardRank(a.awardTier);
    const br = awardRank(b.awardTier);
    if (br !== ar) return br - ar;
    return Number(b.year || 0) - Number(a.year || 0);
  });
}

function summarizeSignals(items: Campaign[]) {
  const formats = new Map<string, number>();
  const topics = new Map<string, number>();
  const industries = new Map<string, number>();
  const years = new Map<number, number>();

  for (const c of items) {
    for (const f of c.formatHints ?? []) formats.set(f, (formats.get(f) ?? 0) + 1);
    for (const t of c.topics ?? []) topics.set(t, (topics.get(t) ?? 0) + 1);
    if (c.industry) industries.set(c.industry, (industries.get(c.industry) ?? 0) + 1);
    if (c.year) years.set(c.year, (years.get(c.year) ?? 0) + 1);
  }

  return {
    formats: topKeys(formats, 3),
    topics: topKeys(topics, 3),
    industries: topKeys(industries, 3),
    years: topYears(years, 5)
  };
}

function withDefaultCitations(text: string, examples: Campaign[]): PatternClaim {
  return { text, citations: examples.map((e) => e.id) };
}

function topicMomentumPatterns(campaigns: Campaign[]): Pattern[] {
  const rows = campaigns.filter((c) => Number(c.year || 0) >= MIN_YEAR && (c.topics?.length || 0) > 0);
  if (!rows.length) return [];

  const recent = rows.filter((c) => Number(c.year || 0) >= RECENT_YEAR);
  const past = rows.filter((c) => Number(c.year || 0) < RECENT_YEAR);
  if (!recent.length || !past.length) return [];

  const recentCounts = new Map<string, number>();
  const pastCounts = new Map<string, number>();
  for (const c of recent) {
    for (const t of c.topics ?? []) recentCounts.set(t, (recentCounts.get(t) ?? 0) + 1);
  }
  for (const c of past) {
    for (const t of c.topics ?? []) pastCounts.set(t, (pastCounts.get(t) ?? 0) + 1);
  }

  const topicRows = uniq([...recentCounts.keys(), ...pastCounts.keys()])
    .map((topic) => {
      const r = recentCounts.get(topic) ?? 0;
      const p = pastCounts.get(topic) ?? 0;
      const total = r + p;
      const recentRate = r / Math.max(1, recent.length);
      const pastRate = p / Math.max(1, past.length);
      const lift = (recentRate + 0.0001) / (pastRate + 0.0001);
      const score = lift * Math.log(total + 1);
      return { topic, r, p, total, lift, score };
    })
    .filter((x) => x.total >= 14 && x.r >= 7 && x.lift >= 1.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return topicRows.map((row) => {
    const examples = scoreExamples(
      rows.filter((c) => (c.topics ?? []).includes(row.topic) && Number(c.year || 0) >= RECENT_YEAR)
    ).slice(0, 6);

    return {
      id: `topic-momentum:${row.topic}`,
      title: `Rising Move: ${row.topic}`,
      summary: [
        withDefaultCitations(
          `Since ${RECENT_YEAR}, “${row.topic}” shows up ${row.r} times vs ${row.p} before.`,
          examples
        ),
        withDefaultCitations(
          `This is a ${row.lift.toFixed(1)}x acceleration, not a short-lived spike.`,
          examples
        ),
        withDefaultCitations(
          `Idea spark: Use ${row.topic} as the tension, then subvert the expected tone.`,
          examples
        )
      ],
      examples,
      signals: summarizeSignals(rows.filter((c) => (c.topics ?? []).includes(row.topic))),
      confidence: {
        support: row.total,
        score: Number(row.score.toFixed(2))
      }
    };
  });
}

function industryCategoryPatterns(campaigns: Campaign[]): Pattern[] {
  const rows = campaigns.filter((c) => c.industry && c.categoryBucket);
  if (!rows.length) return [];

  const globalByCategory = new Map<string, number>();
  const byIndustry = new Map<string, Campaign[]>();
  for (const c of rows) {
    globalByCategory.set(c.categoryBucket!, (globalByCategory.get(c.categoryBucket!) ?? 0) + 1);
    if (!byIndustry.has(c.industry!)) byIndustry.set(c.industry!, []);
    byIndustry.get(c.industry!)!.push(c);
  }

  const globalTotal = rows.length;
  const candidates: Array<{
    industry: string;
    category: string;
    count: number;
    lift: number;
    score: number;
    items: Campaign[];
  }> = [];

  for (const [industry, items] of byIndustry.entries()) {
    if (items.length < 18) continue;
    const byCategory = new Map<string, number>();
    for (const c of items) {
      byCategory.set(c.categoryBucket!, (byCategory.get(c.categoryBucket!) ?? 0) + 1);
    }
    for (const [category, count] of byCategory.entries()) {
      if (count < 7) continue;
      const indRate = count / items.length;
      const globalRate = (globalByCategory.get(category) ?? 0) / Math.max(1, globalTotal);
      const lift = (indRate + 0.0001) / (globalRate + 0.0001);
      if (lift < 1.25) continue;
      const score = lift * Math.log(count + 1);
      candidates.push({ industry, category, count, lift, score, items: items.filter((x) => x.categoryBucket === category) });
    }
  }

  const out: Pattern[] = [];
  const usedIndustry = new Set<string>();
  for (const c of candidates.sort((a, b) => b.score - a.score)) {
    if (usedIndustry.has(c.industry)) continue;
    usedIndustry.add(c.industry);
    const examples = scoreExamples(c.items).slice(0, 6);
    out.push({
      id: `industry-category:${c.industry}:${c.category}`,
      title: `${c.industry} Over-Indexes On ${c.category}`,
      summary: [
        withDefaultCitations(
          `${c.count} winners in ${c.industry} land in ${c.category}.`,
          examples
        ),
        withDefaultCitations(
          `That is a ${c.lift.toFixed(1)}x over-index versus the full library baseline.`,
          examples
        ),
        withDefaultCitations(
          `Idea spark: Steal ${c.category} mechanics, then apply them to a non-obvious channel.`,
          examples
        )
      ],
      examples,
      signals: summarizeSignals(c.items),
      confidence: {
        support: c.count,
        score: Number(c.score.toFixed(2))
      }
    });
    if (out.length >= 3) break;
  }
  return out;
}

function grandPrixMagnetPatterns(campaigns: Campaign[]): Pattern[] {
  const withTopics = campaigns.filter((c) => (c.topics?.length || 0) > 0);
  const grand = withTopics.filter((c) => (c.awardTier || "").toLowerCase().includes("grand"));
  if (!withTopics.length || !grand.length) return [];

  const allCount = new Map<string, number>();
  const grandCount = new Map<string, number>();
  for (const c of withTopics) {
    for (const t of c.topics ?? []) allCount.set(t, (allCount.get(t) ?? 0) + 1);
  }
  for (const c of grand) {
    for (const t of c.topics ?? []) grandCount.set(t, (grandCount.get(t) ?? 0) + 1);
  }

  const scored = [...grandCount.entries()]
    .map(([topic, g]) => {
      const a = allCount.get(topic) ?? 0;
      const gShare = g / Math.max(1, grand.length);
      const aShare = a / Math.max(1, withTopics.length);
      const lift = (gShare + 0.0001) / (aShare + 0.0001);
      const score = lift * Math.log(g + 1);
      return { topic, g, a, lift, score };
    })
    .filter((x) => x.g >= 3 && x.a >= 10 && x.lift >= 1.2)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  return scored.map((row) => {
    const items = grand.filter((c) => (c.topics ?? []).includes(row.topic));
    const examples = scoreExamples(items).slice(0, 6);
    return {
      id: `grand-magnet:${row.topic}`,
      title: `Grand Prix Magnet: ${row.topic}`,
      summary: [
        withDefaultCitations(
          `${row.g} Grand Prix winners tap into “${row.topic}” (from ${row.a} total uses).`,
          examples
        ),
        withDefaultCitations(
          `This topic is ${row.lift.toFixed(1)}x more common in Grand Prix than baseline.`,
          examples
        ),
        withDefaultCitations(
          `Idea spark: Frame ${row.topic} as a behavior shift, not a campaign message.`,
          examples
        )
      ],
      examples,
      signals: summarizeSignals(items),
      confidence: {
        support: row.g,
        score: Number(row.score.toFixed(2))
      }
    };
  });
}

function brandPlatformPatterns(campaigns: Campaign[]): Pattern[] {
  const byBrand = new Map<string, Campaign[]>();
  for (const c of campaigns) {
    if (!c.brand) continue;
    if (!byBrand.has(c.brand)) byBrand.set(c.brand, []);
    byBrand.get(c.brand)!.push(c);
  }

  const rows = [...byBrand.entries()]
    .map(([brand, items]) => {
      const years = uniq(items.map((x) => Number(x.year || 0)).filter(Boolean));
      const span = years.length ? Math.max(...years) - Math.min(...years) : 0;
      const score = items.length * 0.8 + span;
      return { brand, items, years, score };
    })
    .filter((x) => x.items.length >= 3 && x.years.length >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);

  return rows.map((row) => {
    const examples = scoreExamples(row.items).slice(0, 6);
    return {
      id: `brand-platform:${row.brand}`,
      title: `Platform Builder: ${row.brand}`,
      summary: [
        withDefaultCitations(
          `${row.brand} appears ${row.items.length} times across ${row.years.length} different years.`,
          examples
        ),
        withDefaultCitations(
          `This is platform behavior: repeating a strategic lens, not repeating execution.`,
          examples
        ),
        withDefaultCitations(
          `Idea spark: Write one brand stance, then pressure-test it in three formats.`,
          examples
        )
      ],
      examples,
      signals: summarizeSignals(row.items),
      confidence: {
        support: row.items.length,
        score: Number(row.score.toFixed(2))
      }
    };
  });
}

export function generatePatterns(campaigns: Campaign[], maxPatterns = 8): Pattern[] {
  const merged = [
    ...topicMomentumPatterns(campaigns),
    ...industryCategoryPatterns(campaigns),
    ...grandPrixMagnetPatterns(campaigns),
    ...brandPlatformPatterns(campaigns)
  ];

  const unique = new Map<string, Pattern>();
  for (const p of merged) unique.set(p.id, p);

  return [...unique.values()]
    .sort((a, b) => b.confidence.score - a.confidence.score)
    .slice(0, maxPatterns);
}
