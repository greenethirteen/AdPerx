export type Campaign = {
  id: string;
  title: string;
  brand: string;
  agency?: string;
  year?: number;
  sourceUrl?: string;     // LoveTheWorkMore page
  outboundUrl?: string;   // External case study / video / article
  thumbnailUrl?: string;  // Visual preview (og:image / twitter:image)
  awardTier?: string;     // Grand Prix / Gold / Silver / Bronze / Shortlist
  awardCategory?: string; // Raw LTWM category label
  categoryBucket?: string; // Normalized category (Film, Film Craft, Print, Radio/Audio, etc)
  formatHints?: string[]; // film, print, outdoor, digital, pr, integrated...
  topics?: string[];      // women's rights, sustainability...
  industry?: string;      // airlines, finance...
  notes?: string;
};

export type SearchFilters = {
  q?: string;
  preset?: string;
  sort?: "relevance" | "year_desc" | "year_asc";
  years?: number[];
  awardTiers?: string[];
  categories?: string[];
  industry?: string[];
  topics?: string[];
  formats?: string[];
  brands?: string[];
  agencies?: string[];
};

export type FacetCounts = Record<string, number>;

export type SearchResponse = {
  total: number;
  results: (Campaign & { score?: number; highlights?: Record<string, string[]> })[];
  facets: {
    years: FacetCounts;
    awardTiers: FacetCounts;
    categories: FacetCounts;
    industry: FacetCounts;
    topics: FacetCounts;
    formats: FacetCounts;
    brands: FacetCounts;
    agencies: FacetCounts;
  };
};

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

export type PatternsResponse = {
  total: number;
  patterns: Pattern[];
};

export type IdeationItem = {
  technique: string;
  line: string;
  insight: string;
  idea: string;
  execution: string;
  pros: string[];
  citations: string[];
};

export type IdeationResponse = {
  brief: string;
  items: IdeationItem[];
  sources: Campaign[];
};
