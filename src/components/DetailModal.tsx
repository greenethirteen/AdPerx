"use client";

import { useEffect } from "react";
import type { Campaign } from "@/lib/types";
import {
  buildScreenshotThumbnail,
  getBestCampaignLink,
  getNextThumbnailFallback,
  getPreferredThumbnailUrl,
  isRenderableThumbnailUrl
} from "@/lib/links";

export default function DetailModal({
  campaign,
  open,
  onClose
}: {
  campaign: Campaign | null;
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !campaign) return null;

  const link = getBestCampaignLink(campaign);
  const embed = getEmbedUrl(link);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-soft">
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

          <button
            onClick={onClose}
            className="rounded-xl border border-black/10 bg-white px-3 py-2 text-sm hover:bg-black/5"
          >
            Close
          </button>
        </div>

        <div className="grid gap-0 md:grid-cols-5">
          <div className="md:col-span-3">
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
                <img
                  src={getPreferredThumbnailUrl(campaign.thumbnailUrl || "")}
                  alt={`${campaign.brand} — ${campaign.title}`}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    const img = e.currentTarget;
                    const next = getNextThumbnailFallback(img.src);
                    if (next && img.dataset.normalized !== "1") {
                      img.dataset.normalized = "1";
                      img.src = next;
                      return;
                    }
                    const fallback = buildScreenshotThumbnail(link);
                    if (fallback && img.dataset.screenshot !== "1") {
                      img.dataset.screenshot = "1";
                      img.src = fallback;
                      return;
                    }
                    img.style.display = "none";
                  }}
                />
              </div>
            ) : (
              <div className="p-6 text-sm text-black/60">
                No preview available for this link. Use the buttons to open the source.
              </div>
            )}
          </div>

          <div className="md:col-span-2">
            <div className="space-y-3 p-6">
              <a
                className="block rounded-2xl bg-black px-4 py-3 text-center text-sm font-semibold text-white hover:bg-black/90"
                href={link}
                target="_blank"
                rel="noreferrer"
              >
                Open case study →
              </a>

              {campaign.sourceUrl ? (
                <a
                  className="block rounded-2xl border border-black/10 bg-white px-4 py-3 text-center text-sm font-semibold hover:bg-black/5"
                  href={campaign.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open LoveTheWorkMore page
                </a>
              ) : null}

              {campaign.notes ? (
                <div className="rounded-2xl border border-black/10 bg-white p-4 text-sm text-black/70">
                  <div className="text-xs font-semibold text-black/60">Notes</div>
                  <div className="mt-2 whitespace-pre-wrap">{campaign.notes}</div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-black/10 bg-white p-4 text-xs text-black/55">
                Tip: add your own notes and tags in <span className="font-semibold">data/campaigns.json</span>, then rebuild the index.
              </div>
            </div>
          </div>
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
      const id = u.pathname.split("/").filter(Boolean).pop();
      return id ? `https://player.vimeo.com/video/${id}` : "";
    }
    return "";
  } catch {
    return "";
  }
}
