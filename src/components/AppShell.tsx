"use client";

import { useEffect, useMemo, useState } from "react";
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
const VINTAGE_YEARS = Array.from({ length: 1995 - 1954 + 1 }, (_, i) => 1954 + i);

function qsFromFilters(f: SearchFilters) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.preset) p.set("preset", f.preset);
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
    preset: "",
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
  const selectedIndex = useMemo(
    () => (selectedId ? data.results.findIndex((r) => r.id === selectedId) : -1),
    [data.results, selectedId]
  );
  const previousCampaign = selectedIndex > 0 ? data.results[selectedIndex - 1] : null;
  const nextCampaign =
    selectedIndex >= 0 && selectedIndex < data.results.length - 1 ? data.results[selectedIndex + 1] : null;
  const isSuperBowlShortcutActive =
    filters.sort === "year_desc" &&
    (filters.topics ?? []).some((t) => t.toLowerCase() === "super bowl");
  const isCannesShortcutActive =
    !(filters.q ?? "").trim() &&
    !(filters.preset ?? "").trim() &&
    (filters.sort ?? "relevance") === "relevance" &&
    !(filters.years?.length) &&
    !(filters.awardTiers?.length) &&
    !(filters.categories?.length) &&
    !(filters.industry?.length) &&
    !(filters.topics?.length) &&
    !(filters.formats?.length) &&
    !(filters.brands?.length) &&
    !(filters.agencies?.length);
  const isVintageShortcutActive =
    filters.sort === "year_desc" &&
    VINTAGE_YEARS.every((y) => (filters.years ?? []).includes(y)) &&
    (filters.years?.length ?? 0) === VINTAGE_YEARS.length;
  const isErrorsShortcutActive = (filters.preset ?? "").toLowerCase() === "errors";
  const showFiltersPanel = mode === "search";
  const resetToHome = () => {
    setMode("search");
    setSelectedId(null);
    setPage(1);
    setFilters({
      q: "",
      preset: "",
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
  };
  const modeButtonClass = (active: boolean) =>
    [
      "whitespace-nowrap rounded-xl px-2 py-1.5 text-xs shadow-soft transition duration-150 select-none md:px-3 md:py-2 md:text-sm",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2",
      "active:scale-[0.98] active:translate-y-px",
      active
        ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md ring-1 ring-cyan-300/40"
        : "bg-white/70 text-black/80 hover:-translate-y-0.5 hover:bg-white hover:shadow-md"
    ].join(" ");

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
    <div className="mx-auto max-w-7xl px-4 py-6 md:py-8">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <button type="button" className="logo-home-btn" onClick={resetToHome} aria-label="Go to home and reset search">
            <div className="logo-badge-wrap">
              <h1 className="logo-mark text-3xl font-extrabold tracking-tight md:text-5xl">BrainStormer™</h1>
              <p className="logo-submark">POWER SEARCH FOR AWARD WINNING WORK</p>
            </div>
          </button>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5 self-start md:flex-nowrap md:gap-2">
          <button
            className={modeButtonClass(mode === "search")}
            onClick={() => setMode("search")}
            aria-pressed={mode === "search"}
          >
            Search
          </button>
          <button
            className={modeButtonClass(mode === "ask")}
            onClick={() => setMode("ask")}
            aria-pressed={mode === "ask"}
          >
            Ask AI
          </button>
          <button
            className={modeButtonClass(mode === "ideate")}
            onClick={() => setMode("ideate")}
            aria-pressed={mode === "ideate"}
          >
            Idea Generator
          </button>
        </div>
      </header>
      <div className="mt-6 space-y-4">
        {mode === "search" ? (
          <SearchBar
            value={filters.q ?? ""}
            onChange={(q) => setFilters((s) => ({ ...s, q, preset: "" }))}
            quickChips={[
              {
                label: "Cannes Lions Winners",
                variant: "cannes",
                active: isCannesShortcutActive,
                apply: () =>
                  setFilters({
                    q: "",
                    preset: "",
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
                    q: "",
                    preset: "",
                    sort: "year_desc",
                    years: [],
                    awardTiers: [],
                    categories: [],
                    industry: [],
                    topics: ["super bowl"],
                    formats: [],
                    brands: [],
                    agencies: []
                  })
              },
              {
                label: "Vintage",
                variant: "vintage",
                active: isVintageShortcutActive,
                apply: () =>
                  setFilters({
                    q: "",
                    preset: "",
                    sort: "year_desc",
                    years: VINTAGE_YEARS,
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
                label: "Airlines ✈️",
                apply: () =>
                  setFilters({
                    q: "",
                    preset: "airlines",
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
                label: "Olympics",
                apply: () =>
                  setFilters({
                    q: "",
                    preset: "olympics",
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
                label: "Christmas Campaigns",
                apply: () =>
                  setFilters({
                    q: "",
                    preset: "christmas",
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
                    preset: "gaming",
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
                label: "Errors",
                active: isErrorsShortcutActive,
                apply: () =>
                  setFilters({
                    q: "",
                    preset: "errors",
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
            ]}
            onClear={() =>
              setFilters({
                q: "",
                preset: "",
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

        <div className={`grid gap-4 ${showFiltersPanel ? "md:grid-cols-12" : ""}`}>
          {showFiltersPanel ? (
            <aside className="md:col-span-4 lg:col-span-3">
              <FiltersPanel
                filters={filters}
                facets={data.facets}
                onChange={setFilters}
                loading={loading}
              />
            </aside>
          ) : null}

          <main className={showFiltersPanel ? "md:col-span-8 lg:col-span-9" : ""}>
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
        previousCampaign={previousCampaign}
        nextCampaign={nextCampaign}
        onPrevious={() => {
          if (previousCampaign) setSelectedId(previousCampaign.id);
        }}
        onNext={() => {
          if (nextCampaign) setSelectedId(nextCampaign.id);
        }}
        onClose={() => setSelectedId(null)}
      />

      <footer className="mt-10 text-xs text-black/50">
        Built as a metadata indexer + search UI. Always respect source licensing & terms.
      </footer>
      <style jsx>{`
        .logo-home-btn {
          background: transparent;
          border: 0;
          padding: 0;
          cursor: pointer;
          transition: transform 180ms ease, filter 180ms ease;
        }
        .logo-home-btn:hover {
          transform: translateY(-2px) rotate(-0.6deg) scale(1.015);
          filter: saturate(1.08);
        }
        .logo-home-btn:active {
          transform: translateY(0) rotate(-1deg) scale(0.985);
          filter: saturate(0.98);
        }
        .logo-home-btn:focus-visible {
          outline: 2px solid rgba(6, 182, 212, 0.55);
          outline-offset: 4px;
          border-radius: 14px;
        }
        .logo-badge-wrap {
          display: inline-block;
          background: #d71920;
          border-radius: 26px;
          padding: 8px 14px 6px 14px;
          transform: rotate(-2.6deg);
          margin-bottom: 8px;
          box-shadow:
            14px 10px 0 0 #df7a2c,
            26px 18px 0 0 #e6ad35,
            0 2px 0 rgba(0, 0, 0, 0.08);
        }
        @media (min-width: 768px) {
          .logo-badge-wrap {
            margin-bottom: 0;
          }
        }
        .logo-mark {
          color: #f7f2e5;
          font-style: italic;
          font-weight: 900;
          letter-spacing: -0.03em;
          line-height: 0.95;
          text-shadow:
            1px 1px 0 rgba(255, 255, 255, 0.35),
            0 0 1px rgba(0, 0, 0, 0.08);
          transform: skewX(-7deg);
          animation: logoPulse 4.5s ease-in-out infinite;
        }
        .logo-submark {
          margin: 2px 0 0 10px;
          color: #f7f2e5;
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          line-height: 1;
          white-space: nowrap;
          opacity: 0.96;
          transform: skewX(-7deg);
        }
        @media (min-width: 768px) {
          .logo-submark {
            margin-left: 14px;
            font-size: 9px;
          }
        }
        @keyframes logoPulse {
          0% {
            filter: brightness(0.98);
          }
          50% {
            filter: brightness(1.07);
          }
          100% {
            filter: brightness(0.98);
          }
        }
      `}</style>
    </div>
  );
}
