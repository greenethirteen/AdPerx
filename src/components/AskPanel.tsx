"use client";

import { useState } from "react";
import type { SearchFilters } from "@/lib/types";
import { getBestCampaignLink, getNextThumbnailFallback, isRenderableThumbnailUrl } from "@/lib/links";

type AskSource = {
  id: string;
  title: string;
  brand: string;
  year?: number;
  thumbnailUrl?: string;
  bestLink?: string;
  sourceUrl?: string;
  outboundUrl?: string;
};

export default function AskPanel({ filters }: { filters: SearchFilters }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [sources, setSources] = useState<AskSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    const q = question.trim();
    if (!q) return;

    setLoading(true);
    setAnswer("");
    setKeyPoints([]);
    setError(null);
    setSources([]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, filters })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json?.error ?? `Ask failed (HTTP ${res.status}).`);
        return;
      }
      setAnswer(json.answer ?? "");
      setKeyPoints(Array.isArray(json.keyPoints) ? json.keyPoints : []);
      setSources(json.sources ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white/70 p-4 shadow-soft backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Ask the Library</h2>
        <span className="text-xs text-black/60">Answers + linked case studies</span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-5">
        <div className="md:col-span-2">
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder='Examples:
- “Show me the best airline brand platforms and why they worked”
- “Any clever OOH activations around women’s rights?”
- “What Cannes work uses humor to sell travel?”'
            className="h-40 w-full resize-none rounded-2xl border border-black/10 bg-white p-4 text-sm outline-none focus:border-black/20"
          />
          <button
            onClick={run}
            disabled={loading}
            className="mt-3 w-full rounded-2xl bg-black px-4 py-3 text-sm font-semibold text-white hover:bg-black/90 disabled:opacity-60"
          >
            {loading ? "Analyzing…" : "Ask"}
          </button>

          <div className="mt-3 rounded-2xl border border-black/10 bg-white p-4 text-xs text-black/55">
            Ask strategic or creative questions. We return a direct answer and linked visual sources from your case-study
            library.
          </div>
        </div>

        <div className="md:col-span-3">
          <div className="rounded-2xl border border-black/10 bg-white p-5">
            <div className="text-xs font-semibold text-black/60">Answer</div>
            <div className="mt-2 whitespace-pre-wrap text-sm text-black/80">
              {answer || (loading ? "…" : "Ask a question to generate a sourced answer.")}
            </div>

            {keyPoints.length ? (
              <div className="mt-4">
                <div className="text-xs font-semibold text-black/60">Key Points</div>
                <ul className="mt-2 space-y-2 text-sm text-black/80">
                  {keyPoints.map((p, i) => (
                    <li key={`kp-${i}`} className="rounded-xl bg-black/5 px-3 py-2">
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {error ? <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}

            {sources.length ? (
              <div className="mt-4 border-t border-black/10 pt-4">
                <div className="text-xs font-semibold text-black/60">Sources</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {sources.map((s) => {
                    const link = s.bestLink || getBestCampaignLink(s as any);
                    if (!link) return null;
                    return (
                      <a
                        key={s.id}
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="group flex items-center gap-2 rounded-xl border border-black/10 bg-white p-2 text-left text-xs transition hover:-translate-y-px hover:bg-black/5"
                      >
                        {isRenderableThumbnailUrl(s.thumbnailUrl || "") ? (
                          <img
                            src={s.thumbnailUrl}
                            alt=""
                            className="h-12 w-16 rounded-md object-cover"
                            loading="lazy"
                            onError={(e) => {
                              const img = e.currentTarget;
                              const next = getNextThumbnailFallback(img.src);
                              if (next) {
                                img.src = next;
                                return;
                              }
                              img.style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="h-12 w-16 rounded-md bg-black/5" />
                        )}
                        <div className="min-w-0">
                          <div className="truncate font-semibold">
                            {s.brand} — {s.title}
                          </div>
                          <div className="text-[11px] text-black/60">{s.year || ""}</div>
                        </div>
                      </a>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
