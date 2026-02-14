"use client";

import { useState } from "react";
import type { SearchFilters } from "@/lib/types";
import { getBestCampaignLink } from "@/lib/links";

export default function AskPanel({ filters }: { filters: SearchFilters }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string>("");
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  async function run() {
    const q = question.trim();
    if (!q) return;

    setLoading(true);
    setAnswer("");
    setSources([]);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, filters })
      });
      const json = await res.json();
      setAnswer(json.answer ?? "");
      setSources(json.sources ?? []);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl bg-white/70 p-4 shadow-soft backdrop-blur">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Ask</h2>
        <span className="text-xs text-black/60">
          Retrieves relevant work → answers with citations (links)
        </span>
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
            {loading ? "Thinking…" : "Ask"}
          </button>

          <div className="mt-3 rounded-2xl border border-black/10 bg-white p-4 text-xs text-black/55">
            If you add <span className="font-semibold">OPENAI_API_KEY</span> in <span className="font-semibold">.env.local</span>,
            this becomes a true RAG answerer. Without it, you’ll still get a ranked list of sources.
          </div>
        </div>

        <div className="md:col-span-3">
          <div className="rounded-2xl border border-black/10 bg-white p-5">
            <div className="text-xs font-semibold text-black/60">Answer</div>
            <div className="mt-2 whitespace-pre-wrap text-sm text-black/80">
              {answer || (loading ? "…" : "Ask a question to generate a sourced answer.")}
            </div>

            {sources.length ? (
              <div className="mt-4 border-t border-black/10 pt-4">
                <div className="text-xs font-semibold text-black/60">Sources</div>
                <div className="mt-2 space-y-2">
                  {sources.map((s: any) => {
                    const link = getBestCampaignLink(s);
                    if (!link) return null;
                    return (
                      <a
                        key={s.id}
                        href={link}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-xl bg-black/5 p-3 text-sm hover:bg-black/10"
                      >
                        <div className="font-semibold">
                          {s.brand} — {s.title} ({s.year})
                        </div>
                        <div className="truncate text-xs text-black/60">{link}</div>
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
