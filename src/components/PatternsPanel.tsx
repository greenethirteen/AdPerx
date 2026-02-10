"use client";

import { useEffect, useMemo, useState } from "react";
import type { PatternsResponse, SearchFilters } from "@/lib/types";

const EMPTY: PatternsResponse = { total: 0, patterns: [] };

function qsFromFilters(f: SearchFilters) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
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

export default function PatternsPanel({
  filters,
  onSelect
}: {
  filters: SearchFilters;
  onSelect: (id: string) => void;
}) {
  const [data, setData] = useState<PatternsResponse>(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const qs = qsFromFilters(filters);
        const res = await fetch(`/api/patterns?${qs}`);
        if (!res.ok) throw new Error(`Patterns failed: ${res.status}`);
        const json = (await res.json()) as PatternsResponse;
        setData(json);
      } catch {
        setData(EMPTY);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
  }, [filters]);

  const patterns = useMemo(() => data.patterns ?? [], [data]);

  return (
    <div className="rounded-2xl bg-white/70 p-4 shadow-soft backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Pattern Plays</h2>
        <div className="text-xs text-black/60">
          {loading ? "Analyzing…" : `${patterns.length} patterns from ${data.total.toLocaleString()} matches`}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {patterns.map((p) => (
          <div key={p.id} className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-base font-semibold">{p.title}</div>
              <div className="text-xs text-black/60">
                {p.confidence.support} examples{p.confidence.note ? ` • ${p.confidence.note}` : ""}
              </div>
            </div>

            <div className="mt-2 space-y-2 text-sm text-black/80">
              {p.summary.map((s, i) => (
                <div key={`${p.id}-summary-${i}`}>
                  <div className={s.text.toLowerCase().startsWith("idea spark:") ? "rounded-xl bg-amber-50 px-2 py-1 font-semibold text-amber-900" : ""}>
                    {s.text}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {s.citations.slice(0, 5).map((cid) => {
                      const ex = p.examples.find((e) => e.id === cid);
                      const label = ex ? `${ex.brand} — ${ex.title}` : "Source";
                      return (
                        <button
                          key={`${p.id}-cite-${cid}`}
                          onClick={() => onSelect(cid)}
                          className="rounded-full bg-black/5 px-2 py-1 text-xs text-black/70 hover:bg-black/10"
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap gap-2 text-xs text-black/60">
              {p.signals.formats.length ? <Chip label={`Formats: ${p.signals.formats.join(", ")}`} /> : null}
              {p.signals.topics.length ? <Chip label={`Topics: ${p.signals.topics.join(", ")}`} /> : null}
              {p.signals.industries.length ? <Chip label={`Industries: ${p.signals.industries.join(", ")}`} /> : null}
              {p.signals.years.length ? <Chip label={`Years: ${p.signals.years.join(", ")}`} /> : null}
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-black/60">Examples</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                {p.examples.map((e) => (
                  <button
                    key={`${p.id}-ex-${e.id}`}
                    onClick={() => onSelect(e.id)}
                    className="rounded-xl border border-black/10 bg-white px-3 py-2 text-left text-xs hover:bg-black/5"
                  >
                    <div className="font-semibold">{e.brand} — {e.title}</div>
                    <div className="text-black/60">{e.year ?? "—"}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ))}

        {!patterns.length && !loading ? (
          <div className="rounded-xl border border-black/10 bg-white p-6 text-sm text-black/60">
            No patterns found. Try broadening your query or removing filters.
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Chip({ label }: { label: string }) {
  return <span className="rounded-full bg-black/5 px-2 py-1">{label}</span>;
}
