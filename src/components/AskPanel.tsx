"use client";

import { useMemo, useState } from "react";
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

function splitSentences(text: string) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function truncateWords(text: string, maxWords: number) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}...`;
}

function AskMascot({ state }: { state: "idle" | "thinking" | "done" | "error" }) {
  const isThinking = state === "thinking";
  const isDone = state === "done";
  const isError = state === "error";
  const stroke = isError ? "#b42318" : isDone ? "#0e7490" : "#1e3a8a";
  const bgA = isError ? "#fecaca" : isDone ? "#a5f3fc" : "#bae6fd";
  const bgB = isError ? "#fca5a5" : isDone ? "#67e8f9" : "#7dd3fc";

  return (
    <div className="ask-float-slow inline-flex items-center gap-2 rounded-full border border-cyan-200/80 bg-white/90 px-3 py-1.5 shadow-sm">
      <svg
        width="30"
        height="30"
        viewBox="0 0 64 64"
        role="img"
        aria-label={`Ask assistant ${state}`}
        className={isThinking ? "ask-mascot-think" : ""}
      >
        <defs>
          <linearGradient id="askMascotBg" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={bgA} />
            <stop offset="100%" stopColor={bgB} />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r="28" fill="url(#askMascotBg)" stroke={stroke} strokeWidth="2" />
        <circle cx="22" cy="27" r="3.5" fill={stroke} />
        <circle cx="42" cy="27" r="3.5" fill={stroke} />
        {isError ? (
          <path d="M22 45 C30 37, 34 37, 42 45" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
        ) : isDone ? (
          <path d="M20 39 C27 46, 37 46, 44 39" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
        ) : (
          <path d="M24 41 L40 41" fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" />
        )}
        {isThinking ? (
          <>
            <circle cx="51" cy="14" r="3.5" fill="#f8fafc" stroke={stroke} strokeWidth="1.5" />
            <circle cx="57" cy="9" r="2" fill="#f8fafc" stroke={stroke} strokeWidth="1.3" />
          </>
        ) : null}
      </svg>
      <span className={`font-ui text-[11px] font-medium ${isError ? "text-rose-700" : "text-cyan-800"}`}>
        {isThinking ? "Thinking" : isError ? "Retry" : isDone ? "Done" : "Ready"}
      </span>
    </div>
  );
}

function AskSpectrum() {
  return (
    <div className="ask-osc-shell mt-4 rounded-2xl border border-cyan-200/45 bg-gradient-to-br from-cyan-50/60 via-white/75 to-blue-50/60 p-4">
      <div className="ask-osc-frame relative h-44 overflow-hidden rounded-xl border border-cyan-100/60 bg-[#090d1a]">
        <div className="ask-osc-glow absolute inset-0" />
        <div className="ask-osc-container relative mx-auto w-[220px] pt-8">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="ask-osc-ball" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AskPanel({ filters }: { filters: SearchFilters }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [keyPoints, setKeyPoints] = useState<string[]>([]);
  const [sources, setSources] = useState<AskSource[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const quickPrompts = [
    "Best airline campaigns and why they worked",
    "What are the strongest women’s rights campaign strategies?",
    "Find Super Bowl campaigns that used humor effectively",
    "Which travel campaigns made OOH feel fresh?"
  ];

  const mascotState: "idle" | "thinking" | "done" | "error" = loading
    ? "thinking"
    : error
      ? "error"
      : answer
        ? "done"
        : "idle";

  const structured = useMemo(() => {
    const sentences = splitSentences(answer);
    return {
      headline: sentences[0] ? truncateWords(sentences[0], 14) : "",
      summary: truncateWords(sentences.slice(1).join(" "), 50),
      routes: keyPoints.slice(0, 4).map((k) => truncateWords(k, 16))
    };
  }, [answer, keyPoints]);

  function getAskErrorMessage(status: number, apiError?: string) {
    if (status === 502) {
      return "Live web search is temporarily unavailable. Ask requires web retrieval, so please retry in a moment.";
    }
    return apiError || `Ask failed (HTTP ${status}).`;
  }

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
        setError(getAskErrorMessage(res.status, json?.error));
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
    <div className="ask-aurora relative overflow-hidden rounded-3xl border border-black/10 bg-white/75 p-4 shadow-soft backdrop-blur md:p-6">
      <div className="ask-float-slow pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-cyan-200/40 blur-3xl" />
      <div className="ask-float-alt pointer-events-none absolute -right-20 top-2 h-56 w-56 rounded-full bg-blue-200/35 blur-3xl" />
      <div className="relative">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="font-ui text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">Strategy Assistant</p>
            <h2 className="font-display text-xl font-semibold tracking-tight text-black/90 md:text-2xl">Ask the Library</h2>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-ui rounded-full border border-cyan-200/80 bg-cyan-50 px-3 py-1 text-[11px] font-medium text-cyan-800">
              Answers + linked case studies
            </span>
            <AskMascot state={mascotState} />
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-5">
          <div className="md:col-span-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  run();
                }
              }}
              placeholder='Try:
- “Best airline campaigns and why they worked”
- “Any clever OOH activations around women’s rights?”
- “What Cannes work uses humor to sell travel?”'
              className="font-ui h-44 w-full resize-none rounded-2xl border border-black/10 bg-white/90 p-4 text-sm leading-relaxed outline-none transition focus:border-cyan-400/50 focus:ring-2 focus:ring-cyan-100"
            />
            <button
              onClick={run}
              disabled={loading}
              className={`font-ui mt-3 w-full rounded-2xl bg-gradient-to-r from-cyan-500 via-blue-600 to-indigo-700 px-4 py-3 text-sm font-semibold text-white shadow-soft transition hover:brightness-105 disabled:opacity-60 ${loading ? "ask-shimmer" : ""}`}
            >
              {loading ? "Analyzing..." : "Ask"}
            </button>
            <div className="font-ui mt-2 text-[11px] text-black/55">Tip: press Ctrl/Cmd + Enter to run</div>

            <div className="mt-3 rounded-2xl border border-black/10 bg-white/90 p-4">
              <div className="font-ui text-[11px] font-semibold uppercase tracking-[0.14em] text-black/45">Quick Prompts</div>
              <div className="mt-2 grid gap-2">
                {quickPrompts.map((p) => (
                  <button
                    key={p}
                    onClick={() => setQuestion(p)}
                    className="font-ui rounded-xl border border-black/10 bg-black/[0.03] px-3 py-2 text-left text-xs text-black/70 transition hover:border-cyan-300/50 hover:bg-cyan-50/70"
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="md:col-span-3">
            <div className="rounded-2xl border border-black/10 bg-gradient-to-br from-white via-white to-blue-50/50 p-5">
              <div className="flex items-center justify-between gap-2">
                <div className="font-ui text-xs font-semibold uppercase tracking-[0.12em] text-black/55">Answer Deck</div>
                <span className="font-ui rounded-full border border-black/10 bg-white px-2.5 py-1 text-[10px] text-black/55">
                  RAG + Live Web
                </span>
              </div>

              {answer ? (
                <div className="mt-3 space-y-3">
                  <div className="rounded-xl border border-black/10 bg-white/85 p-3">
                    <div className="font-ui text-[10px] font-semibold uppercase tracking-[0.14em] text-black/45">Core Strategic Angle</div>
                    <div className="font-display mt-1 text-xl leading-tight text-black/90">{structured.headline}</div>
                  </div>
                  <div className="rounded-xl border border-black/10 bg-white/85 p-3">
                    <div className="font-ui text-[10px] font-semibold uppercase tracking-[0.14em] text-black/45">Strategic Read</div>
                    <div className="font-ui mt-1 text-sm leading-relaxed text-black/80">
                      {structured.summary || truncateWords(answer, 50)}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="font-ui mt-3 rounded-xl border border-black/10 bg-white/80 p-3 text-sm leading-relaxed text-black/70">
                  {loading ? <>Pulling sources and building response<span className="ask-dots" /></> : "Ask a strategic or creative question to generate a sourced answer."}
                </div>
              )}

              {structured.routes.length ? (
                <div className="mt-4">
                  <div className="font-ui text-xs font-semibold uppercase tracking-[0.12em] text-black/55">Action Routes</div>
                  <ul className="mt-2 grid gap-2 text-sm text-black/80 md:grid-cols-2">
                    {structured.routes.map((p, i) => (
                      <li key={`kp-${i}`} className="rounded-xl border border-black/10 bg-white/85 px-3 py-2">
                        <div className="font-ui text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-700">Route {i + 1}</div>
                        <div className="font-ui mt-1 text-sm leading-snug">{p}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {error ? <div className="font-ui mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}

              {sources.length ? (
                <div className="mt-4 border-t border-black/10 pt-4">
                  <div className="font-ui text-xs font-semibold uppercase tracking-[0.12em] text-black/55">Sources</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {sources.map((s, i) => {
                      const link = s.bestLink || getBestCampaignLink(s as any);
                      if (!link) return null;
                      return (
                        <a
                          key={s.id}
                          href={link}
                          target="_blank"
                          rel="noreferrer"
                          className="ask-rise-in group flex items-center gap-2 rounded-xl border border-black/10 bg-white p-2 text-left text-xs transition hover:-translate-y-px hover:border-cyan-300/50 hover:bg-cyan-50/40"
                          style={{ animationDelay: `${i * 55}ms` }}
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
                            <div className="font-ui truncate font-semibold text-black/85">
                              {s.brand} — {s.title}
                            </div>
                            <div className="font-ui text-[11px] text-black/60">{s.year || ""}</div>
                          </div>
                          <div className="ml-auto text-black/40 transition group-hover:text-cyan-700">↗</div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <AskSpectrum />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
