"use client";

import { useMemo, useState } from "react";
import type { IdeationResponse, SearchFilters } from "@/lib/types";
import { ALL_PURPOSE_TECHNIQUES } from "@/lib/techniques";
import { getBestCampaignLink, getNextThumbnailFallback, isRenderableThumbnailUrl } from "@/lib/links";

const EMPTY: IdeationResponse = { brief: "", items: [], sources: [] };
const DEMO_BRIEF = "Give me creative idea angles for a Harvey Nichols Christmas Sale Campaign.";
const DEMO_LINES: Array<[string, string, string, string]> = [
  [
    "ES01 Glorify People",
    "Crown Britain's most legendary gift-giver, one Christmas save at a time.",
    "Christmas status gets assigned by who gives the gift everyone talks about first.",
    "Build a social leaderboard of Gift Legends with weekly winners shoppable in-store and online."
  ],
  [
    "ES02 Honour a Place",
    "Turn every Harvey Nichols store into the city's official House of Christmas Taste.",
    "People trust culturally authoritative places to validate what premium taste looks like.",
    "Create city-specific gift edits and storefront takeovers that localize the sale by neighborhood identity."
  ],
  [
    "ES03 Get Behind an Attitude",
    "Start a festive movement: no more safe gifts, only statement gifts.",
    "Gifting confidence starts with choosing a point of view, not just a product.",
    "Launch a manifesto-led campaign with attitude archetypes and matching gift collections across paid social."
  ],
  [
    "ES04 Elevate an Object",
    "Make the gift box the trophy, so the wrapping itself signals elite taste.",
    "The object carrying the gift can become shorthand for intention and quality.",
    "Design a signature sale wrap system that appears in film, OOH, and unboxing creator content."
  ],
  [
    "ES05 Celebrate a Journey",
    "Follow one gift from first hunch to final gasp as the season's hero arc.",
    "Great gifting feels rewarding because the chooser's journey is socially visible.",
    "Run episodic content tracking curation from shortlist to reveal, with each step shoppable."
  ],
  [
    "ES06 Cherish a Moment",
    "Build the campaign around one priceless second: the face at first unwrap.",
    "The emotional peak is the reveal moment, not the purchase moment.",
    "Capture real reaction shots and compile them into short-form edits and in-store screen loops."
  ],
  [
    "ES07 Empathise and Support",
    "Launch a 'Gift Panic Clinic' for people who've left it dangerously late.",
    "Last-minute shoppers want expert rescue without being judged for procrastination.",
    "Offer live gift triage via chat, creator streams, and in-store rapid curation stations."
  ],
  [
    "ES08 Dramatise the Problem",
    "Show the social chaos caused by forgettable gifts in painfully relatable detail.",
    "Bad gifts create awkward social aftershocks that linger beyond the exchange.",
    "Produce comedic fallout films where each gifting fail is traced to a fixable decision."
  ],
  [
    "ES09 Dramatise the Solution",
    "Show one Harvey Nichols gift instantly changing the temperature of the whole room.",
    "A single high-fit gift can reset mood, status, and group energy immediately.",
    "Stage before/after reveal scenes across film and vertical edits linked to featured products."
  ],
  [
    "ES10 Use an Analogy for the Problem",
    "Frame bad gifting as bringing supermarket wine to a Michelin dinner.",
    "Analogy helps people instantly understand taste errors without long explanation.",
    "Build analogy-led OOH and paid social copy mapping weak choices to premium alternatives."
  ],
  [
    "ES11 Use an Analogy for the Solution",
    "Position Harvey Nichols as the Christmas equivalent of a world-class curator.",
    "Curation feels more valuable when framed like expertise in culture institutions.",
    "Present gift edits as curated exhibitions with chaptered films and gallery-style retail zones."
  ],
  [
    "ES12 Humanise",
    "Let gifts speak for themselves and plead their case to be chosen.",
    "Anthropomorphism makes product differences memorable and emotionally legible at speed.",
    "Create character-led gift auditions in Shorts and TikTok with shoppable verdict cards."
  ],
  [
    "ES13 Compare and Contrast",
    "Run a festive side-by-side: 'forgettable by midnight' vs 'talked about till New Year.'",
    "Contrast clarifies quality by making consequences of each choice explicit.",
    "Use split-screen comparisons across digital, CRM, and in-store displays to drive decisions."
  ],
  [
    "ES14 Rename, Redefine, Reclassify",
    "Reclassify Christmas shopping as reputation design, not errand-running.",
    "Language reframes behavior; naming can elevate how seriously people shop.",
    "Deploy a renamed gift taxonomy across CRM, PDP modules, and social creative templates."
  ],
  [
    "ES15 Invite the Audience Backstage",
    "Open the doors to the edit room where the season's best gifts are selected.",
    "People value outcomes more when they see the selection logic behind them.",
    "Publish behind-the-scenes curation diaries with buyers, stylists, and category experts."
  ],
  [
    "ES16 Hire a Surprising Endorser",
    "Put a brutally honest child on the judging panel for 'actually good gifts.'",
    "Unexpected judges cut through polished brand messaging and feel more credible.",
    "Create a recurring judging format where unlikely endorsers score gift picks on camera."
  ],
  [
    "ES17 Transport Them to Other Worlds",
    "Make each gift category a portal to a different festive fantasy world.",
    "World-building helps shoppers browse by mood rather than purely by category.",
    "Develop themed micro-worlds for key categories across interactive web, OOH, and windows."
  ],
  [
    "ES18 Stand Up for the Little Guy",
    "Champion the overlooked recipients: the plus-one, the host, the office unsung hero.",
    "People appreciate brands that recognize socially invisible but meaningful relationships.",
    "Launch an unsung-recipient gift finder and campaign stories spotlighting forgotten roles."
  ],
  [
    "ES19 Invent a Mascot",
    "Create 'The Gift Detective,' a character who spots weak presents on sight.",
    "A mascot gives memory structure and continuity across many campaign placements.",
    "Build episodic detective content diagnosing gift mistakes and prescribing premium fixes."
  ],
  [
    "ES20 Debunk a Stereotype",
    "Bust the myth that luxury gifting has to mean extravagant spend.",
    "Many shoppers overestimate luxury cost and opt out before browsing.",
    "Run myth-vs-fact creative with price-anchored edits and direct conversion routes."
  ],
  [
    "ES21 Conduct an Experiment",
    "Run a live experiment proving reaction quality rises with better-curated gifts.",
    "Observed evidence persuades faster when personal taste claims feel subjective.",
    "Execute controlled social experiments and publish measurable response deltas by gift strategy."
  ]
];

const DEMO_ITEMS: IdeationResponse["items"] = DEMO_LINES.map(([technique, line, insight, execution]) => ({
  technique,
  line,
  insight,
  idea: "",
  execution,
  pros: [],
  citations: []
}));

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
  const [progress, setProgress] = useState(0);
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
    setProgress(0);
    setData({
      brief: q,
      items: ALL_PURPOSE_TECHNIQUES.map((t) => ({
        technique: t,
        line: "",
        insight: "",
        idea: "",
        execution: "",
        pros: [],
        citations: []
      })),
      sources: []
    });
    setError(null);
    try {
      const res = await fetch("/api/ideate", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "accept": "text/event-stream"
        },
        body: JSON.stringify({ brief: q, filters, stream: true })
      });
      if (!res.ok) {
        let json: any = null;
        try {
          json = await res.json();
        } catch {
          json = null;
        }
        const msg = json?.error ?? `Failed to generate ideas (HTTP ${res.status}).`;
        setError(msg);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("Streaming response unavailable.");
      const decoder = new TextDecoder();
      let buffer = "";
      let done = false;

      while (!done) {
        const next = await reader.read();
        done = next.done;
        buffer += decoder.decode(next.value ?? new Uint8Array(), { stream: !done });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const evt of events) {
          const dataLine = evt
            .split("\n")
            .find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;
          const parsed = JSON.parse(payload) as
            | { type: "start"; brief: string; sources: IdeationResponse["sources"] }
            | { type: "item"; item: IdeationResponse["items"][number]; index: number }
            | { type: "done" }
            | { type: "error"; error: string };

          if (parsed.type === "start") {
            setData((prev) => ({ ...prev, brief: parsed.brief, sources: parsed.sources ?? [] }));
            continue;
          }
          if (parsed.type === "item") {
            setProgress((n) => n + 1);
            setData((prev) => ({
              ...prev,
              items: prev.items.map((it, i) => (i === parsed.index ? parsed.item : it))
            }));
            continue;
          }
          if (parsed.type === "error") {
            setError(parsed.error || "Failed to generate ideas.");
          }
        }
      }
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
            <div className="rounded-2xl border border-black/10 bg-gradient-to-r from-emerald-700 via-green-700 to-lime-700 p-4 text-white shadow-soft">
              <p className="text-xs uppercase tracking-[0.22em] text-white/70">Creative Engine</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-tight">BrainStormer™</h2>
              <p className="mt-1 text-sm text-white/80">
                Stuck in a brainstorm with nothing smart to say? Is your CD grilling you? Are you about to be fired?
                Generate ideas that actually work with BrainStormer™. Not ChatGPT slop.
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
                  {loading ? `BrainStormer™ generating live… ${progress}/${ALL_PURPOSE_TECHNIQUES.length}` : "Run BrainStormer™"}
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
