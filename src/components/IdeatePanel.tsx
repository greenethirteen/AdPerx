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
    line: "When luxury panics: the sale that makes high-end shoppers lose composure.",
    insight: "For style-led audiences, the emotional tension is not price, it is access before everyone else.",
    idea: "Show polished, composed people breaking character the moment Harvey Nichols drops the sale.",
    execution: "Film + social cutdowns where elegant rituals collapse into chaotic-but-stylish urgency. End frame: 'Composure is overrated. Sale now on.'",
    pros: ["Strong social meme potential", "Ownable tone for Harvey Nichols", "Built for film and vertical edits"],
    citations: []
  },
  {
    technique: "Gift Diplomacy",
    line: "The politics of gifting: who deserves iconic, who gets 'safe'.",
    insight: "Holiday shopping is full of unspoken hierarchy: inner circle vs obligation gifting.",
    idea: "Harvey Nichols becomes the place where gifting strategy is solved with precision and flair.",
    execution: "Interactive guide + OOH: 'Gift by relationship risk'. Pair with premium-but-discounted edits by persona.",
    pros: ["Retail utility + humor", "CRM and email friendly", "High conversion intent"],
    citations: []
  },
  {
    technique: "Calendar Hijack",
    line: "Christmas starts when Harvey Nichols says so.",
    insight: "Most holiday campaigns are interchangeable; audiences reward brands that call the season with authority.",
    idea: "Launch a branded moment: 'The First Markdown' as a cultural trigger for festive shopping.",
    execution: "Teaser countdown, creator seeding, live 'price drop bell' content, and in-store event moments.",
    pros: ["Creates annual platform potential", "Drives urgency without discount fatigue", "Good PR angle"],
    citations: []
  },
  {
    technique: "Aspirational Utility",
    line: "Party-proof your December wardrobe for less than expected.",
    insight: "Shoppers want luxury looks that survive multiple events, not one-off statement pieces.",
    idea: "Position the sale as 'high rotation, high impact' investment dressing.",
    execution: "Style systems content: 1 hero piece, 5 festive scenarios. Shoppable bundles across channels.",
    pros: ["Practical value message", "High merchandising flexibility", "E-commerce ready"],
    citations: []
  },
  {
    technique: "Luxury Confession Booth",
    line: "The secret things people do for a designer bargain.",
    insight: "The most shareable festive shopping truths are mildly embarrassing and deeply relatable.",
    idea: "Invite shoppers and creators to confess their 'sale behavior' in a premium-styled format.",
    execution: "Street + social interview format with cinematic lighting and rapid edits. End tag: 'You’re among friends at Harvey Nichols.'",
    pros: ["Highly social-native", "Creator-compatible", "Builds festive participation"],
    citations: []
  },
  {
    technique: "The Last-Minute Prestige Rescue",
    line: "For people who remembered everyone else first.",
    insight: "Late gifting triggers anxiety around quality and thoughtfulness at the same time.",
    idea: "Frame Harvey Nichols as the fastest route to looking intentional, not rushed.",
    execution: "Dynamic digital OOH + paid social tied to countdown moments: '48 hours left to look like you planned this months ago.'",
    pros: ["Strong conversion urgency", "Great for retargeting windows", "Clear role for paid media"],
    citations: []
  },
  {
    technique: "Style Arbitration",
    line: "Let the crowd settle festive style disputes in real time.",
    insight: "Holiday dressing decisions are high-friction and people want permission to choose boldly.",
    idea: "Launch live style face-offs using sale items, where the audience votes the winner.",
    execution: "Interactive stories + live shopping events: 'Boardroom party vs black-tie chaos'. Winning looks become featured bundles.",
    pros: ["Interactive engagement", "Merchandising by demand", "Community-led proof"],
    citations: []
  },
  {
    technique: "Anti-Perfect Christmas",
    line: "Celebrate the messy, brilliant reality of festive life.",
    insight: "Perfect-holiday advertising is often ignored; imperfect honesty feels premium when done with wit.",
    idea: "Harvey Nichols champions beautifully imperfect festive moments — great outfits, chaotic timelines.",
    execution: "Film series: burnt canapes, late arrivals, dramatic reunions — but impeccable looks sourced from sale edits.",
    pros: ["Distinctive tonal lane", "Brand character building", "Cross-channel storytelling"],
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
        <div className="rounded-2xl border border-black/10 bg-gradient-to-r from-black via-slate-900 to-zinc-900 p-4 text-white shadow-soft">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-white/70">Creative Engine</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">BrainStormer™</h2>
              <p className="mt-1 text-sm text-white/80">
                Turn a rough brief into idea territories, execution routes, and source-backed references.
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/85">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-300" />
              AI-assisted and archive-grounded
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-5">
          <div className="space-y-3 md:col-span-2">
            <div className="rounded-2xl border border-black/10 bg-white/90 p-4 shadow-soft">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/55">Brief Input</div>
              <textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Paste your brief: product, audience, tension, desired behavior, channel constraints."
                className="h-52 w-full resize-none rounded-2xl border border-black/10 bg-white p-4 text-sm outline-none focus:border-black/30 focus:ring-2 focus:ring-cyan-100"
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
