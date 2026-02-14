"use client";

import { useEffect } from "react";
import type { Campaign } from "@/lib/types";
import {
  getBestCampaignLink,
  getNextThumbnailFallback,
  getPreferredThumbnailUrl,
  isRenderableThumbnailUrl
} from "@/lib/links";

export default function DetailModal({
  campaign,
  open,
  previousCampaign,
  nextCampaign,
  onPrevious,
  onNext,
  onClose
}: {
  campaign: Campaign | null;
  open: boolean;
  previousCampaign: Campaign | null;
  nextCampaign: Campaign | null;
  onPrevious: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrevious();
      if (e.key === "ArrowRight") onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onPrevious, onNext]);

  if (!open || !campaign) return null;

  const link = getBestCampaignLink(campaign);
  const embed = getEmbedUrl(link);
  const hasSideColumn = Boolean(campaign.notes);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-soft">
        <div className="flex items-start justify-between gap-4 border-b border-black/10 p-5">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-black/60">{campaign.brand}</div>
            <h3 className="mt-1 text-xl font-semibold">{campaign.title}</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {campaign.year ? <Pill>{campaign.year}</Pill> : null}
              {campaign.industry ? <Pill>{campaign.industry}</Pill> : null}
              {(campaign.formatHints ?? []).map((t) => (
                <Pill key={t}>{t}</Pill>
              ))}
              {(campaign.topics ?? []).map((t) => (
                <Pill key={t}>{t}</Pill>
              ))}
            </div>
            {campaign.agency ? <div className="mt-2 text-sm text-black/60">{campaign.agency}</div> : null}
          </div>

          <div className="flex min-w-[220px] flex-col gap-2">
            <div className="flex items-center gap-2">
              <button
                onClick={onPrevious}
                disabled={!previousCampaign}
                className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
                title={previousCampaign ? "Previous case study" : "No previous case study"}
              >
                ← Prev
              </button>
              <button
                onClick={onNext}
                disabled={!nextCampaign}
                className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40"
                title={nextCampaign ? "Next case study" : "No next case study"}
              >
                Next →
              </button>
              <button
                onClick={onClose}
                className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm hover:bg-black/5"
              >
                Close
              </button>
            </div>
            <a
              className={`block rounded-2xl px-4 py-3 text-center text-sm font-semibold text-white ${link ? "bg-black hover:bg-black/90" : "cursor-not-allowed bg-black/30"}`}
              href={link || undefined}
              target={link ? "_blank" : undefined}
              rel={link ? "noreferrer" : undefined}
              aria-disabled={!link}
              onClick={(e) => {
                if (!link) e.preventDefault();
              }}
            >
              {link ? "Open case study →" : "No case-study link available"}
            </a>
          </div>
        </div>

        <div className={`grid gap-0 ${hasSideColumn ? "md:grid-cols-5" : ""}`}>
          <div className={hasSideColumn ? "md:col-span-4" : ""}>
            {embed ? (
              <div className="aspect-video w-full bg-black">
                <iframe
                  className="h-full w-full"
                  src={embed}
                  title="Preview"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>
            ) : isRenderableThumbnailUrl(campaign.thumbnailUrl || "") ? (
              <div className="aspect-video w-full bg-black/5">
                <div className="relative h-full w-full">
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-black/50">No preview</div>
                  <img
                    src={getPreferredThumbnailUrl(campaign.thumbnailUrl || "")}
                    alt={`${campaign.brand} — ${campaign.title}`}
                    className="relative z-10 h-full w-full object-cover"
                    onError={(e) => {
                      const img = e.currentTarget;
                      const next = getNextThumbnailFallback(img.src);
                      if (next && next !== img.src) {
                        img.src = next;
                        return;
                      }
                      img.style.display = "none";
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="p-6 text-sm text-black/60">
                No preview available for this link. Use the buttons to open the source.
              </div>
            )}
          </div>

          {hasSideColumn ? (
            <div className="md:col-span-1">
              <div className="space-y-3 p-6">
                <div className="rounded-2xl border border-black/10 bg-white p-4 text-sm text-black/70">
                  <div className="text-xs font-semibold text-black/60">Notes</div>
                  <div className="mt-2 whitespace-pre-wrap">{campaign.notes}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-black/5 px-3 py-1 text-xs text-black/70">{children}</span>;
}

function getEmbedUrl(url: string) {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      return v ? `https://www.youtube.com/embed/${v}` : "";
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace("/", "");
      return id ? `https://www.youtube.com/embed/${id}` : "";
    }
    if (u.hostname.includes("vimeo.com")) {
      const parts = u.pathname.split("/").filter(Boolean);
      const numeric = parts.find((p) => /^\d+$/.test(p));
      const id =
        u.hostname.includes("player.vimeo.com") && parts[0] === "video"
          ? parts[1]
          : numeric || parts[0];
      const hashFromPath = parts.find((p) => /^[a-f0-9]{8,}$/i.test(p));
      const hash = u.searchParams.get("h") || hashFromPath || "";
      if (!id) return "";
      return `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ""}`;
    }
    return "";
  } catch {
    return "";
  }
}
