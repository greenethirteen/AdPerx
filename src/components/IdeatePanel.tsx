"use client";

import { useMemo, useState } from "react";
import type { IdeationResponse, SearchFilters } from "@/lib/types";
import { ALL_PURPOSE_TECHNIQUES } from "@/lib/techniques";
import { getBestCampaignLink, getNextThumbnailFallback, isRenderableThumbnailUrl } from "@/lib/links";

const EMPTY: IdeationResponse = { brief: "", items: [], sources: [] };
const DEMO_BRIEF = "Give me creative idea angles for a Harvey Nichols Christmas Sale Campaign.";
const DEMO_ITEMS: IdeationResponse["items"] = [
  {
    technique: "Status Inversion",
    line: "The most stylish person in the room is usually the best gift-giver.",
    insight: "At Christmas, gifting signals taste, timing, and cultural awareness in one move.",
    idea: "Position Harvey Nichols as the shortcut to gifts that feel instantly iconic.",
    execution: "Film + social: polished scenes flip into high-energy reactions after one standout Harvey Nichols reveal.",
    pros: ["Strong social meme potential", "Ownable tone for Harvey Nichols", "Built for film and vertical edits"],
    citations: []
  },
  {
    technique: "Consequence Theater",
    line: "One brilliant gift can change the whole mood of the night.",
    insight: "The best festive gifts create social momentum, not just a transaction.",
    idea: "Dramatize the positive domino effect of gifting well through Harvey Nichols.",
    execution: "Short films: one gift sparks better conversations, bolder style, and a more unforgettable celebration.",
    pros: ["High drama = high attention", "Clear emotional tension", "Easy episodic format"],
    citations: []
  },
  {
    technique: "Reputation Insurance",
    line: "Your gift is your reputation, wrapped.",
    insight: "Holiday gifting is reputation management disguised as kindness.",
    idea: "Make Harvey Nichols feel like social insurance for high-stakes relationships.",
    execution: "OOH + paid social with playful risk scoring by recipient type, then premium fix recommendations.",
    pros: ["Simple strategic frame", "Sharp copy system", "Easy to localize"],
    citations: []
  },
  {
    technique: "Passive-Aggressive Carol",
    line: "A Christmas choir celebrates unexpectedly brilliant gifting choices in public.",
    insight: "Festive theater amplifies emotion; praise becomes memorable when it feels performative.",
    idea: "Turn gifting wins into public micro-moments people want to record and share.",
    execution: "Pop-up choirs in key retail zones singing witty praise lines tied to featured Harvey Nichols picks.",
    pros: ["Street-level spectacle", "Highly shareable", "Distinctive Harvey tone"],
    citations: []
  },
  {
    technique: "Guilt Ledger",
    line: "Track your gifting evolution from safe choices to elite choices.",
    insight: "People enjoy proof that their taste is getting sharper each season.",
    idea: "Create a playful 'Gift Upgrade Index' powered by Harvey Nichols curation.",
    execution: "Interactive microsite + CRM: input recipient profile, get score + curated high-impact shortlist.",
    pros: ["Strong data capture", "High conversion intent", "Memorable utility"],
    citations: []
  },
  {
    technique: "Luxury Witness Protection",
    line: "Late shoppers can still look like meticulous planners.",
    insight: "People do not want to look rushed; they want to look intentional.",
    idea: "Make Harvey Nichols the fast lane to high-taste gifting confidence.",
    execution: "Film-led campaign: shoppers enter a 'rapid curation' booth and exit with perfectly matched gifts.",
    pros: ["Comedic world-building", "Distinctive visual asset", "Clear sale role"],
    citations: []
  },
  {
    technique: "Social Courtroom",
    line: "Put gift options on trial and crown the undisputed winner.",
    insight: "People love participatory formats where taste gets debated with humor.",
    idea: "Create a festive 'court of taste' where the audience helps pick the best gift.",
    execution: "TikTok/YouTube series with comic judge; audience votes, winning Harvey Nichols pick becomes shoppable.",
    pros: ["Built for episodic content", "Strong participation loop", "Commerce integrated"],
    citations: []
  },
  {
    technique: "Tabloid Future",
    line: "Tomorrow's headline: 'Gift game changed overnight.'",
    insight: "People want gifting moments that feel current, confident, and conversation-worthy.",
    idea: "Project upbeat future headlines triggered by bold Harvey Nichols gift decisions.",
    execution: "AI-style tabloid OOH and social headlines paired with direct links to the featured products.",
    pros: ["Striking visual language", "Fast-turn creative system", "High memorability"],
    citations: []
  }
];

export default function IdeatePanel({
  filters,
  onSelect
}: {
  filters: SearchFilters;
  onSelect: (id: string) => void;
}) {
  const [brief, setBrief] = useState(DEMO_BRIEF);
  const [data, setData] = useState<IdeationResponse>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clamp = (s: string, n: number) => {
    const t = (s ?? "").trim();
    if (!t) return "—";
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };

  const sourceMap = useMemo(() => {
    const map = new Map<string, { label: string; thumb?: string; href?: string }>();
    for (const s of data.sources ?? []) {
      const href = getBestCampaignLink(s);
      map.set(s.id, { label: `${s.brand} — ${s.title}`, thumb: s.thumbnailUrl, href });
    }
    return map;
  }, [data.sources]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/text\/|\.txt$|\.md$|\.rtf$/i.test(file.type || file.name)) {
      alert("Please upload a plain text, markdown, or RTF file.");
      return;
    }
    const text = await file.text();
    setBrief(text.slice(0, 5000));
  }

  async function run() {
    const q = brief.trim();
    if (!q) return;
    setLoading(true);
    setData(EMPTY);
    setError(null);
    try {
      const res = await fetch("/api/ideate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brief: q, filters })
      });
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (!res.ok) {
        const msg = json?.error ?? `Failed to generate ideas (HTTP ${res.status}).`;
        setError(msg);
        return;
      }
      setData(json as IdeationResponse);
    } finally {
      setLoading(false);
    }
  }

  const items = data.items?.length
    ? data.items
    : (DEMO_ITEMS?.length
        ? DEMO_ITEMS
        : ALL_PURPOSE_TECHNIQUES.map((t) => ({
            technique: t,
            line: "",
            insight: "",
            idea: "",
            execution: "",
            pros: [],
            citations: []
          })));

  return (
    <div className="relative overflow-hidden rounded-3xl border border-black/10 bg-white/75 p-4 shadow-soft backdrop-blur md:p-6">
      <div className="pointer-events-none absolute -left-16 -top-16 h-56 w-56 rounded-full bg-cyan-200/30 blur-3xl" />
      <div className="pointer-events-none absolute -right-16 top-8 h-56 w-56 rounded-full bg-rose-200/30 blur-3xl" />
      <div className="relative">
        <div className="mt-2 grid gap-4 md:grid-cols-5">
          <div className="space-y-3 md:col-span-2">
            <div className="rounded-2xl border border-black/10 bg-gradient-to-r from-black via-slate-900 to-zinc-900 p-4 text-white shadow-soft">
              <p className="text-xs uppercase tracking-[0.22em] text-white/70">Creative Engine</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">BrainStormer™</h2>
              <p className="mt-1 text-sm text-white/80">
                Turn a rough brief into idea territories, execution routes, and source-backed references.
              </p>
              <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/85">
                <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
                AI-assisted and archive-grounded
              </div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/90 p-4 shadow-soft">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/55">Brief Input</div>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Paste your brief: product, audience, tension, desired behavior, channel constraints."
                className="h-36 w-full resize-none rounded-2xl border border-black/10 bg-white p-4 text-sm outline-none focus:border-black/30 focus:ring-2 focus:ring-cyan-100"
              />
              <div className="mt-3 flex items-center gap-2">
                <label className="cursor-pointer rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-black/80 hover:bg-black/5">
                  Upload brief
                  <input type="file" className="hidden" onChange={onFile} />
                </label>
                <button
                  onClick={run}
                  disabled={loading}
                  className="flex-1 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-4 py-2 text-xs font-semibold text-white transition hover:brightness-95 disabled:opacity-60"
                >
                  {loading ? "BrainStormer™ is thinking…" : "Run BrainStormer™"}
                </button>
              </div>
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/90 p-4 text-xs text-black/60">
              Requires <span className="font-semibold">OPENAI_API_KEY</span> in <span className="font-semibold">.env.local</span>.
              Outputs include citations that open specific reference work.
            </div>

            <div className="rounded-2xl border border-black/10 bg-white/90 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-black/55">Output Frame</div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-black/70">
                <div className="rounded-xl border border-black/10 bg-black/[0.03] px-2 py-2 text-center">Technique</div>
                <div className="rounded-xl border border-black/10 bg-black/[0.03] px-2 py-2 text-center">Insight</div>
                <div className="rounded-xl border border-black/10 bg-black/[0.03] px-2 py-2 text-center">Execution</div>
              </div>
            </div>

            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
            ) : null}
          </div>

          <div className="md:col-span-3">
            <div className="space-y-3">
              {items.map((item, idx) => (
                <div key={item.technique} className="rounded-3xl border border-black/10 bg-white/95 p-5 shadow-soft">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
                        #{String(idx + 1).padStart(2, "0")} {item.technique}
                      </div>
                      <div className="mt-1 text-lg font-semibold leading-snug text-black">{clamp(item.line, 96)}</div>
                    </div>
                    <div className="shrink-0 rounded-full border border-black/10 bg-black/5 px-3 py-1 text-[11px] font-semibold text-black/65">
                      Idea Route
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-orange-700">Insight</div>
                      <div className="mt-1 text-sm text-orange-900">{clamp(item.insight, 140)}</div>
                    </div>
                    <div className="rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-sky-50 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700">Execution</div>
                      <div className="mt-1 text-sm text-sky-900">{clamp(item.execution, 140)}</div>
                    </div>
                  </div>

                  {item.pros?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-black/70">
                      {item.pros.slice(0, 4).map((p, i) => (
                        <span
                          key={`${item.technique}-pro-${i}`}
                          className="rounded-full border border-black/10 bg-gradient-to-r from-white to-black/[0.02] px-2 py-1"
                        >
                          {clamp(p, 56)}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {(item.citations ?? []).slice(0, 4).map((cid) => {
                      const src = sourceMap.get(cid);
                      if (!src?.href) {
                        return (
                          <button
                            key={`${item.technique}-${cid}`}
                            onClick={() => onSelect(cid)}
                            className="group flex items-center gap-2 rounded-xl border border-black/10 bg-white p-2 text-left text-xs transition hover:-translate-y-px hover:bg-black/5"
                          >
                            {isRenderableThumbnailUrl(src?.thumb || "") ? (
                              <img
                                src={src?.thumb}
                                alt=""
                                className="h-10 w-14 rounded-md object-cover"
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
                              <div className="h-10 w-14 rounded-md bg-black/5" />
                            )}
                            <div className="line-clamp-2">{src?.label ?? "Source"}</div>
                          </button>
                        );
                      }
                      return (
                        <a
                          key={`${item.technique}-${cid}`}
                          href={src.href}
                          target="_blank"
                          rel="noreferrer"
                          className="group flex items-center gap-2 rounded-xl border border-black/10 bg-white p-2 text-left text-xs transition hover:-translate-y-px hover:bg-black/5"
                        >
                          {isRenderableThumbnailUrl(src?.thumb || "") ? (
                            <img
                              src={src?.thumb}
                              alt=""
                              className="h-10 w-14 rounded-md object-cover"
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
                            <div className="h-10 w-14 rounded-md bg-black/5" />
                          )}
                          <div className="line-clamp-2">{src?.label ?? "Source"}</div>
                        </a>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
