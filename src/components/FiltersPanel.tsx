"use client";

import { useState } from "react";
import type { FacetCounts, SearchFilters } from "@/lib/types";

export default function FiltersPanel({
  filters,
  facets,
  onChange,
  loading
}: {
  filters: SearchFilters;
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
  onChange: (f: SearchFilters) => void;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl bg-white/70 p-4 shadow-soft backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Filters</h2>
        {loading ? <span className="text-xs text-black/50">Searching…</span> : null}
      </div>

      <div className="mt-4 space-y-4">
        <Facet
          title="Award Tier"
          values={facets.awardTiers}
          selected={filters.awardTiers ?? []}
          onToggle={(v) => onChange({ ...filters, awardTiers: toggle(filters.awardTiers ?? [], v) })}
          limit={8}
        />
        <Facet
          title="Category"
          values={facets.categories}
          selected={filters.categories ?? []}
          onToggle={(v) => onChange({ ...filters, categories: toggle(filters.categories ?? [], v) })}
          limit={12}
        />
        <Facet
          title="Year"
          values={sortNumberKeys(facets.years)}
          selected={(filters.years ?? []).map(String)}
          onToggle={(v) => {
            const years = toggle((filters.years ?? []).map(String), v).map(Number);
            onChange({ ...filters, years });
          }}
          limit={12}
        />
        <Facet
          title="Industry"
          values={facets.industry}
          selected={filters.industry ?? []}
          onToggle={(v) => onChange({ ...filters, industry: toggle(filters.industry ?? [], v) })}
          limit={12}
        />
        <Facet
          title="Topics"
          values={facets.topics}
          selected={filters.topics ?? []}
          onToggle={(v) => onChange({ ...filters, topics: toggle(filters.topics ?? [], v) })}
          limit={12}
        />
        <Facet
          title="Format"
          values={facets.formats}
          selected={filters.formats ?? []}
          onToggle={(v) => onChange({ ...filters, formats: toggle(filters.formats ?? [], v) })}
          limit={12}
        />

        <div className="rounded-xl border border-black/10 bg-white p-3">
          <p className="text-xs text-black/60">
            Tip: start with <span className="font-semibold">Award Tier</span> + <span className="font-semibold">Category</span>, then tighten by year.
          </p>
        </div>
      </div>
    </div>
  );
}

function toggle(arr: string[], v: string) {
  const set = new Set(arr);
  if (set.has(v)) set.delete(v);
  else set.add(v);
  return Array.from(set);
}

function sortNumberKeys(map: FacetCounts): FacetCounts {
  const entries = Object.entries(map)
    .filter(([k]) => k && k !== "0")
    .sort((a, b) => Number(b[0]) - Number(a[0]));
  return Object.fromEntries(entries);
}

function Facet({
  title,
  values,
  selected,
  onToggle,
  limit
}: {
  title: string;
  values: FacetCounts;
  selected: string[];
  onToggle: (v: string) => void;
  limit: number;
}) {
  const allEntries = Object.entries(values)
    .filter(([k]) => k && k !== "0")
    .sort((a, b) => b[1] - a[1]);
  const [expanded, setExpanded] = useState(false);
  const entries = expanded ? allEntries : allEntries.slice(0, limit);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-black/60">{title}</h3>
        {selected.length ? (
          <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs">{selected.length}</span>
        ) : null}
      </div>

      {entries.length ? (
        <>
          <div className="flex flex-wrap gap-2">
            {entries.map(([k, c]) => {
              const active = selected.includes(k);
              return (
                <button
                  key={k}
                  onClick={() => onToggle(k)}
                  className={`rounded-full px-3 py-1.5 text-xs transition ${
                    active ? "bg-black text-white" : "bg-black/5 hover:bg-black/10"
                  }`}
                  title={`${c} items`}
                >
                  {k} <span className={`${active ? "text-white/70" : "text-black/50"}`}>· {c}</span>
                </button>
              );
            })}
          </div>
          {allEntries.length > limit ? (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-xs font-semibold text-black/60 hover:text-black"
            >
              {expanded ? `Show less` : `Show ${allEntries.length - limit} more`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-xs text-black/45">No facet values yet for this filter.</p>
      )}
    </div>
  );
}
