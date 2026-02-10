"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { SearchFilters, SearchResponse } from "@/lib/types";
import SearchBar from "./SearchBar";
import FiltersPanel from "./FiltersPanel";
import ResultsGrid from "./ResultsGrid";
import DetailModal from "./DetailModal";
import AskPanel from "./AskPanel";
import PatternsPanel from "./PatternsPanel";
import IdeatePanel from "./IdeatePanel";

const EMPTY: SearchResponse = {
  total: 0,
  results: [],
  facets: { years: {}, awardTiers: {}, categories: {}, industry: {}, topics: {}, formats: {}, brands: {}, agencies: {} }
};
const PAGE_SIZE = 48;

function qsFromFilters(f: SearchFilters) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.sort && f.sort !== "relevance") p.set("sort", f.sort);
  for (const y of f.years ?? []) p.append("years", String(y));
  for (const v of f.awardTiers ?? []) p.append("awardTiers", v);
  for (const v of f.categories ?? []) p.append("categories", v);
  for (const v of f.industry ?? []) p.append("industry", v);
  for (const v of f.topics ?? []) p.append("topics", v);
  for (const v of f.formats ?? []) p.append("formats", v);
  for (const v of f.brands ?? []) p.append("brands", v);
  for (const v of f.agencies ?? []) p.append("agencies", v);
  return p.toString();
}

export default function AppShell() {
  const [filters, setFilters] = useState<SearchFilters>({
    q: "",
    sort: "relevance",
    years: [],
    awardTiers: [],
    categories: [],
    industry: [],
    topics: [],
    formats: [],
    brands: [],
    agencies: []
  });

  const [data, setData] = useState<SearchResponse>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"search" | "ask" | "patterns" | "ideate">("search");
  const [page, setPage] = useState(1);

  const selected = useMemo(
    () => data.results.find((r) => r.id === selectedId) ?? null,
    [data.results, selectedId]
  );
  const isSuperBowlShortcutActive =
    filters.sort === "year_desc" &&
    (filters.q ?? "").toLowerCase().includes("super bowl");

  useEffect(() => {
    setPage(1);
  }, [filters]);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const qs = qsFromFilters(filters);
        const offset = (page - 1) * PAGE_SIZE;
        const res = await fetch(`/api/search?${qs}&limit=${PAGE_SIZE}&offset=${offset}`);
        if (!res.ok) throw new Error(`Search failed: ${res.status}`);
        const json = (await res.json()) as SearchResponse;
        setData(json);
      } catch {
        setData(EMPTY);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [filters, page]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2">
            <span className="rounded-full bg-black/5 px-2 py-1 text-xs font-semibold">MVP</span>
            <span className="text-xs text-black/60">Metadata + links • Your searchable inspiration vault</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">
            <Link href="/" className="transition hover:text-black/75">
              AdPerx
            </Link>{" "}
            <span className="text-black/50">— Perplexity for advertising</span>
          </h1>
          <p className="max-w-2xl text-sm text-black/65">
            Find award-winning work fast: search, filter by industry (e.g., airlines), topics, formats, and open previews.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className={`rounded-xl px-3 py-2 text-sm shadow-soft transition ${mode === "search" ? "bg-white" : "bg-white/50 hover:bg-white"}`}
            onClick={() => setMode("search")}
          >
            Search
          </button>
          <button
            className={`rounded-xl px-3 py-2 text-sm shadow-soft transition ${mode === "ask" ? "bg-white" : "bg-white/50 hover:bg-white"}`}
            onClick={() => setMode("ask")}
          >
            Ask (RAG)
          </button>
          <button
            className={`rounded-xl px-3 py-2 text-sm shadow-soft transition ${mode === "patterns" ? "bg-white" : "bg-white/50 hover:bg-white"}`}
            onClick={() => setMode("patterns")}
          >
            Show patterns
          </button>
          <button
            className={`rounded-xl px-3 py-2 text-sm shadow-soft transition ${mode === "ideate" ? "bg-white" : "bg-white/50 hover:bg-white"}`}
            onClick={() => setMode("ideate")}
          >
            BrainStormer™
          </button>
        </div>
      </header>

      <div className="mt-6 space-y-4">
        {mode === "search" ? (
          <SearchBar
            value={filters.q ?? ""}
            onChange={(q) => setFilters((s) => ({ ...s, q }))}
            quickChips={[
              {
                label: "Grand Prix",
                apply: () =>
                  setFilters({
                    q: "",
                    sort: "relevance",
                    years: [],
                    awardTiers: ["Grand Prix"],
                    categories: [],
                    industry: [],
                    topics: [],
                    formats: [],
                    brands: [],
                    agencies: []
                  })
              },
              {
                label: "Airlines ✈️",
                apply: () =>
                  setFilters({
                    q: "",
                    sort: "relevance",
                    years: [],
                    awardTiers: [],
                    categories: [],
                    industry: ["airlines"],
                    topics: [],
                    formats: [],
                    brands: [],
                    agencies: []
                  })
              },
              {
                label: "Olympics",
                apply: () =>
                  setFilters({
                    q: "olympic olympics",
                    sort: "relevance",
                    years: [],
                    awardTiers: [],
                    categories: [],
                    industry: [],
                    topics: [],
                    formats: [],
                    brands: [],
                    agencies: []
                  })
              },
              {
                label: "Super Bowl Ads",
                variant: "spotlight",
                active: isSuperBowlShortcutActive,
                apply: () =>
                  setFilters({
                    q: "super bowl big game commercial",
                    sort: "year_desc",
                    years: [],
                    awardTiers: [],
                    categories: [],
                    industry: [],
                    topics: ["sports"],
                    formats: [],
                    brands: [],
                    agencies: []
                  })
              },
              {
                label: "Christmas Campaigns",
                apply: () =>
                  setFilters({
                    q: "christmas holiday",
                    sort: "relevance",
                    years: [],
                    awardTiers: [],
                    categories: [],
                    industry: [],
                    topics: [],
                    formats: [],
                    brands: [],
                    agencies: []
                  })
              },
              {
                label: "Gaming Campaigns",
                apply: () =>
                  setFilters({
                    q: "",
                    sort: "relevance",
                    years: [],
                    awardTiers: [],
                    categories: [],
                    industry: [],
                    topics: ["gaming"],
                    formats: [],
                    brands: [],
                    agencies: []
                  })
              }
            ]}
            onClear={() =>
              setFilters({
                q: "",
                sort: "relevance",
                years: [],
                awardTiers: [],
                categories: [],
                industry: [],
                topics: [],
                formats: [],
                brands: [],
                agencies: []
              })
            }
          />
        ) : null}

        <div className="grid gap-4 md:grid-cols-12">
          <aside className="md:col-span-4 lg:col-span-3">
            <FiltersPanel
              filters={filters}
              facets={data.facets}
              onChange={setFilters}
              loading={loading}
            />
          </aside>

          <main className="md:col-span-8 lg:col-span-9">
            {mode === "ask" ? (
              <AskPanel filters={filters} />
            ) : mode === "patterns" ? (
              <PatternsPanel filters={filters} onSelect={(id) => setSelectedId(id)} />
            ) : mode === "ideate" ? (
              <IdeatePanel filters={filters} onSelect={(id) => setSelectedId(id)} />
            ) : (
              <ResultsGrid
                loading={loading}
                total={data.total}
                results={data.results}
                page={page}
                pageSize={PAGE_SIZE}
                onPageChange={setPage}
                onSelect={(id) => setSelectedId(id)}
              />
            )}
          </main>
        </div>
      </div>

      <DetailModal
        campaign={selected}
        open={Boolean(selected)}
        onClose={() => setSelectedId(null)}
      />

      <footer className="mt-10 text-xs text-black/50">
        Built as a metadata indexer + search UI. Always respect source licensing & terms.
      </footer>
    </div>
  );
}
