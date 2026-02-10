"use client";

import type { Campaign } from "@/lib/types";
import {
  buildScreenshotThumbnail,
  getBestCampaignLink,
  getNextThumbnailFallback,
  getPreferredThumbnailUrl,
  isRenderableThumbnailUrl
} from "@/lib/links";

export default function ResultsGrid({
  loading,
  total,
  results,
  page,
  pageSize,
  onPageChange,
  onSelect
}: {
  loading: boolean;
  total: number;
  results: Campaign[];
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onSelect: (id: string) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const start = total ? (currentPage - 1) * pageSize + 1 : 0;
  const end = Math.min(currentPage * pageSize, total);
  const canPrev = currentPage > 1 && !loading;
  const canNext = currentPage < pageCount && !loading;

  return (
    <div className="rounded-2xl bg-white/70 p-4 shadow-soft backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Results</h2>
        <PaginationControls
          loading={loading}
          total={total}
          start={start}
          end={end}
          currentPage={currentPage}
          pageCount={pageCount}
          canPrev={canPrev}
          canNext={canNext}
          onPageChange={onPageChange}
        />
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c.id)}
            className="group rounded-2xl border border-black/10 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft"
          >
            <div className="mb-3 overflow-hidden rounded-xl border border-black/10 bg-black/5">
              {isRenderableThumbnailUrl(c.thumbnailUrl || "") ? (
                <img
                  src={getPreferredThumbnailUrl(c.thumbnailUrl || "")}
                  alt={`${c.brand} — ${c.title}`}
                  className="h-32 w-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    const img = e.currentTarget;
                    const next = getNextThumbnailFallback(img.src);
                    if (next && img.dataset.normalized !== "1") {
                      img.dataset.normalized = "1";
                      img.src = next;
                      return;
                    }
                    const fallback = buildScreenshotThumbnail(getBestCampaignLink(c));
                    if (fallback && img.dataset.screenshot !== "1") {
                      img.dataset.screenshot = "1";
                      img.src = fallback;
                      return;
                    }
                    img.style.display = "none";
                  }}
                />
              ) : (
                <div className="flex h-32 w-full items-center justify-center text-xs text-black/50">
                  No preview
                </div>
              )}
            </div>

            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-black/60">{c.brand}</div>
                <div className="mt-1 line-clamp-2 text-sm font-semibold">{c.title}</div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <AwardTierBadge tier={c.awardTier} />
                <div className="rounded-full bg-black/5 px-2 py-1 text-xs text-black/60">{c.year ?? "—"}</div>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {c.industry ? <Tag>{c.industry}</Tag> : null}
              {(c.formatHints ?? []).slice(0, 2).map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
              {(c.topics ?? []).slice(0, 1).map((t) => (
                <Tag key={t}>{t}</Tag>
              ))}
            </div>

            <div className="mt-3 text-xs text-black/50">
              {c.agency ? <span className="truncate">{c.agency}</span> : <span>—</span>}
            </div>

            <div className="mt-3 text-xs font-semibold text-black/60 group-hover:text-black">
              Open preview →
            </div>
          </button>
        ))}

        {!results.length && !loading ? (
          <div className="col-span-full rounded-xl border border-black/10 bg-white p-6 text-sm text-black/60">
            No results. Try removing a filter, or search broader terms like “airline”, “film”, “integrated”, “women”.
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-end">
        <PaginationControls
          loading={loading}
          total={total}
          start={start}
          end={end}
          currentPage={currentPage}
          pageCount={pageCount}
          canPrev={canPrev}
          canNext={canNext}
          onPageChange={onPageChange}
        />
      </div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-black/5 px-2 py-1 text-xs text-black/70">{children}</span>;
}

function PaginationControls({
  loading,
  total,
  start,
  end,
  currentPage,
  pageCount,
  canPrev,
  canNext,
  onPageChange
}: {
  loading: boolean;
  total: number;
  start: number;
  end: number;
  currentPage: number;
  pageCount: number;
  canPrev: boolean;
  canNext: boolean;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-black/60">
      {loading ? "Loading…" : `${total.toLocaleString()} matches`}
      <span className="text-black/40">•</span>
      <span>
        {start}-{end}
      </span>
      <span className="text-black/40">•</span>
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={!canPrev}
        className="rounded-md border border-black/10 bg-white px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Prev
      </button>
      <span className="text-[11px]">
        Page {currentPage}/{pageCount}
      </span>
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={!canNext}
        className="rounded-md border border-black/10 bg-white px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40"
      >
        Next
      </button>
    </div>
  );
}

function AwardTierBadge({ tier }: { tier?: string }) {
  const raw = (tier || "").trim().toLowerCase();
  if (!raw) return null;

  const config = raw.includes("grand")
    ? { label: "Grand Prix", icon: "GP", cls: "border-purple-300 bg-purple-50 text-purple-700" }
    : raw.includes("gold")
      ? { label: "Gold", icon: "G", cls: "border-amber-300 bg-amber-50 text-amber-700" }
      : raw.includes("silver")
        ? { label: "Silver", icon: "S", cls: "border-slate-300 bg-slate-50 text-slate-700" }
        : raw.includes("bronze")
          ? { label: "Bronze", icon: "B", cls: "border-orange-300 bg-orange-50 text-orange-700" }
          : null;

  if (!config) return null;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-semibold ${config.cls}`}>
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[9px]">
        {config.icon}
      </span>
      {config.label}
    </span>
  );
}
