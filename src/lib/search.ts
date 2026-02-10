import type { Campaign, FacetCounts, SearchFilters, SearchResponse } from "./types";
import { getData } from "./data";

function inc(map: FacetCounts, key: string | undefined) {
  const k = (key ?? "").trim();
  if (!k) return;
  map[k] = (map[k] ?? 0) + 1;
}

function incMany(map: FacetCounts, arr: string[] | undefined) {
  for (const v of arr ?? []) inc(map, v);
}

function normalizeArr(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.flatMap((x) => x.split(",")).map((s) => s.trim()).filter(Boolean);
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function normalizeYears(v: string | string[] | undefined): number[] {
  const arr = normalizeArr(v);
  return arr.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

function matchesAny(hay: string | undefined, needles: string[]) {
  if (!needles.length) return true;
  const h = (hay ?? "").toLowerCase();
  return needles.some((n) => h === n.toLowerCase());
}

function matchesAnyInArray(hay: string[] | undefined, needles: string[]) {
  if (!needles.length) return true;
  const set = new Set((hay ?? []).map((x) => x.toLowerCase()));
  return needles.some((n) => set.has(n.toLowerCase()));
}

export function parseFiltersFromQuery(q: URLSearchParams): SearchFilters {
  const sort = q.get("sort") ?? "relevance";
  return {
    q: q.get("q") ?? "",
    sort: sort === "year_desc" || sort === "year_asc" ? sort : "relevance",
    years: normalizeYears(q.getAll("years")),
    awardTiers: normalizeArr(q.getAll("awardTiers")),
    categories: normalizeArr(q.getAll("categories")),
    industry: normalizeArr(q.getAll("industry")),
    topics: normalizeArr(q.getAll("topics")),
    formats: normalizeArr(q.getAll("formats")),
    brands: normalizeArr(q.getAll("brands")),
    agencies: normalizeArr(q.getAll("agencies"))
  };
}

export function runSearch(filters: SearchFilters, limit = 48, offset = 0): SearchResponse {
  const { campaigns, mini } = getData();

  const q = (filters.q ?? "").trim();

  let base: (Campaign & { score?: number; highlights?: Record<string, string[]> })[] = [];

  if (q) {
    const hits = mini.search(q, { prefix: true });
    base = hits.map((h) => ({ ...(h as any), score: h.score, highlights: h.match ?? undefined }));
  } else {
    base = campaigns.map((c) => ({ ...c, score: 0 }));
  }

  const filtered = base.filter((c) => {
    if (filters.years?.length && !filters.years.includes(Number(c.year ?? 0))) return false;
    if (filters.awardTiers?.length && !matchesAny(c.awardTier, filters.awardTiers)) return false;
    if (filters.categories?.length && !matchesAny(c.categoryBucket, filters.categories)) return false;
    if (filters.industry?.length && !matchesAny(c.industry, filters.industry)) return false;
    if (filters.brands?.length && !matchesAny(c.brand, filters.brands)) return false;
    if (filters.agencies?.length && !matchesAny(c.agency, filters.agencies)) return false;
    if (filters.topics?.length && !matchesAnyInArray(c.topics, filters.topics)) return false;
    if (filters.formats?.length && !matchesAnyInArray(c.formatHints, filters.formats)) return false;
    return true;
  });

  // Facets are calculated on the filtered set (like modern search UIs)
  const facets = {
    years: {} as FacetCounts,
    awardTiers: {} as FacetCounts,
    categories: {} as FacetCounts,
    industry: {} as FacetCounts,
    topics: {} as FacetCounts,
    formats: {} as FacetCounts,
    brands: {} as FacetCounts,
    agencies: {} as FacetCounts
  };

  for (const c of filtered) {
    inc(facets.years, String(c.year ?? ""));
    inc(facets.awardTiers, c.awardTier);
    inc(facets.categories, c.categoryBucket);
    inc(facets.industry, c.industry);
    incMany(facets.topics, c.topics);
    incMany(facets.formats, c.formatHints);
    inc(facets.brands, c.brand);
    inc(facets.agencies, c.agency);
  }

  if (filters.sort === "year_desc") {
    filtered.sort((a, b) => {
      const ay = Number(a.year ?? 0);
      const by = Number(b.year ?? 0);
      if (by !== ay) return by - ay;
      return (b.score ?? 0) - (a.score ?? 0);
    });
  } else if (filters.sort === "year_asc") {
    filtered.sort((a, b) => {
      const ay = Number(a.year ?? 9999);
      const by = Number(b.year ?? 9999);
      if (ay !== by) return ay - by;
      return (b.score ?? 0) - (a.score ?? 0);
    });
  } else {
    filtered.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  }
  const start = Math.max(0, offset);
  const results = filtered.slice(start, start + limit);

  return { total: filtered.length, results, facets };
}
