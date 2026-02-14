import { NextResponse } from "next/server";
import { runSearch } from "@/lib/search";
import { ALL_PURPOSE_TECHNIQUES } from "@/lib/techniques";
import type { Campaign, IdeationItem, SearchFilters } from "@/lib/types";

export const runtime = "nodejs";

type IdeateReq = {
  brief: string;
  filters?: SearchFilters;
};

function pickSources(results: Campaign[], n = 12) {
  const usable = results.filter((r) => {
    const t = (r.title ?? "").replace(/\s+/g, " ").trim();
    if (!t || t.length > 180) return false;
    if (/\n|\r/.test(t)) return false;
    const separators = (t.match(/\s[-–]\s/g) ?? []).length;
    if (separators > 4) return false;
    return true;
  });
  return usable.slice(0, n).map((r) => ({
    id: r.id,
    title: r.title,
    brand: r.brand,
    agency: r.agency ?? "",
    year: r.year ?? 0,
    industry: r.industry ?? "",
    topics: (r.topics ?? []).slice(0, 4),
    formatHints: (r.formatHints ?? []).slice(0, 3),
    sourceUrl: r.sourceUrl ?? "",
    outboundUrl: r.outboundUrl ?? "",
    thumbnailUrl: r.thumbnailUrl ?? ""
  }));
}

async function callOpenAIWithTools(
  brief: string,
  techniques: string[],
  sources: ReturnType<typeof pickSources>,
  modelOverride?: string
) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = modelOverride || process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const system = [
    "You are a creative strategist.",
    "Use ONLY the provided sources (campaign metadata + links) for evidence.",
    "For each technique, produce a Creative Angle, an insight, a big idea, and a concrete execution.",
    "The Creative Angle must be edgy, culturally sharp, and non-obvious (not a slogan).",
    "Push hard: left-field, high-tension, and provocative-but-brand-safe ideas.",
    "Avoid generic ad-school ideas such as: countdowns, 'exclusive deals', personal stylists, serene shopping oasis, social media teasers.",
    "Each execution must name a concrete mechanic and channel in one line.",
    "Use short, punchy lines (roughly 9-18 words each).",
    "Each technique should feel meaningfully different from the others.",
    "Add 2-3 pros (short bullets) that explain why the idea is strong.",
    "Every item must include 2–5 citations (campaign ids) drawn from the sources.",
    "Do not invent campaigns or citations.",
    "Return JSON only with the exact schema requested."
  ].join(" ");

  const user = {
    brief,
    techniques,
    sources
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const tool = {
    type: "function",
    function: {
      name: "emit_ideas",
      description: "Return ideas per technique with citations.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                technique: { type: "string" },
                line: { type: "string" },
                insight: { type: "string" },
                idea: { type: "string" },
                execution: { type: "string" },
                pros: { type: "array", items: { type: "string" } },
                citations: { type: "array", items: { type: "string" } }
              },
              required: ["technique", "line", "insight", "idea", "execution", "pros", "citations"]
            }
          }
        },
        required: ["items"]
      }
    }
  };
  const useMaxCompletion = model.startsWith("gpt-5");
  const body: any = {
    model,
    temperature: 0.9,
    tools: [tool],
    tool_choice: { type: "function", function: { name: "emit_ideas" } },
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) }
    ]
  };
  if (useMaxCompletion) {
    body.max_completion_tokens = 1200;
  } else {
    body.max_tokens = 700;
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${key}`
    },
    body: JSON.stringify(body),
    signal: controller.signal
  });
  clearTimeout(timeout);

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = await res.json();
  const msg = json.choices?.[0]?.message;
  const toolCall = msg?.tool_calls?.[0];
  if (toolCall?.function?.arguments) return toolCall.function.arguments as string;
  const content = msg?.content ?? "";
  if (!content) {
    const reason = json.choices?.[0]?.finish_reason ?? "unknown";
    throw new Error(`Empty response (finish_reason: ${reason}).`);
  }
  return content;
}

async function callOpenAIPlain(
  brief: string,
  techniques: string[],
  sources: ReturnType<typeof pickSources>,
  modelOverride?: string
) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  const model = modelOverride || process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const system = [
    "You are a creative strategist.",
    "Use ONLY the provided sources (campaign metadata + links) for evidence.",
    "For each technique, produce a witty campaign line, an insight, a big idea, and a concrete execution.",
    "Make ideas edgy, specific, and left-field.",
    "Avoid safe/generic routes like countdowns, generic urgency, personal stylists, or vague influencer content.",
    "Each execution must include a concrete mechanic + channel + payoff in one sentence.",
    "Keep text concise (roughly 9-18 words each), non-obvious, and punchy.",
    "Each technique should feel clearly different from the others.",
    "Add 2-3 pros (short bullets) that explain why the idea is strong.",
    "Every item must include 2–5 citations (campaign ids) drawn from the sources.",
    "Do not invent campaigns or citations.",
    "Return JSON only with shape: { items: [{ technique, line, insight, idea, execution, pros: string[], citations: string[] }] }"
  ].join(" ");

  const user = {
    brief,
    techniques,
    sources
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  const useMaxCompletion = model.startsWith("gpt-5");
  const body: any = {
    model,
    temperature: 0.9,
    messages: [
      { role: "system", content: system },
      { role: "user", content: JSON.stringify(user) }
    ]
  };
  if (useMaxCompletion) {
    body.max_completion_tokens = 1200;
  } else {
    body.max_tokens = 700;
  }

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${key}`
    },
    body: JSON.stringify(body),
    signal: controller.signal
  });
  clearTimeout(timeout);

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = await res.json();
  const msg = json.choices?.[0]?.message;
  const content = msg?.content ?? "";
  if (!content) {
    const reason = json.choices?.[0]?.finish_reason ?? "unknown";
    throw new Error(`Empty response (finish_reason: ${reason}).`);
  }
  return content;
}
function safeParseItems(raw: string, techniques: string[], validCitationIds: Set<string>): IdeationItem[] | null {
  try {
    const tidy = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const slice = start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw;
    const obj = JSON.parse(slice);
    const items = Array.isArray(obj.items) ? obj.items : null;
    if (!items) return null;
    const normalized: IdeationItem[] = items
      .filter((x: any) => x && typeof x.technique === "string")
      .map((x: any) => ({
        technique: x.technique,
        line: tidy(x.line, 180),
        insight: tidy(x.insight, 220),
        idea: tidy(x.idea, 220),
        execution: tidy(x.execution, 220),
        pros: Array.isArray(x.pros) ? x.pros.map((p: unknown) => tidy(p, 90)).filter(Boolean).slice(0, 3) : [],
        citations: Array.isArray(x.citations)
          ? x.citations.map(String).filter((id: string) => validCitationIds.has(id)).slice(0, 5)
          : []
      }));
    if (!normalized.length) return null;
    // Ensure full coverage order
    const map = new Map(normalized.map((i) => [i.technique, i]));
    const fallbackCitations = Array.from(validCitationIds).slice(0, 2);
    return techniques.map(
      (t) =>
        map.get(t) ?? { technique: t, line: "", insight: "", idea: "", execution: "", pros: [], citations: fallbackCitations }
    );
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as IdeateReq;
    const brief = (body.brief ?? "").trim();
    if (!brief) return NextResponse.json({ error: "Missing brief" }, { status: 400 });

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 400 });
    }

    const filters: SearchFilters = { ...(body.filters ?? {}), q: brief };
    const search = runSearch(filters, 60);
    const sources = pickSources(search.results, 6);
    const validCitationIds = new Set(sources.map((s) => s.id));

    let items: IdeationItem[] | null = null;
    let failure: string | null = null;
    try {
      const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
      const chunkSize = model.startsWith("gpt-5") ? 2 : 3;
      const chunks: string[][] = [];
      for (let i = 0; i < ALL_PURPOSE_TECHNIQUES.length; i += chunkSize) {
        chunks.push(ALL_PURPOSE_TECHNIQUES.slice(i, i + chunkSize));
      }
      const all: IdeationItem[] = [];
      for (const chunk of chunks) {
        let raw = await callOpenAIWithTools(brief, chunk, sources);
        if (!raw) {
          raw = await callOpenAIPlain(brief, chunk, sources);
        }
        if (!raw) {
          // Final fallback to a stable model
          raw = await callOpenAIPlain(brief, chunk, sources, "gpt-4.1-mini");
        }
        if (!raw) throw new Error("Empty OpenAI response.");
        const parsed = safeParseItems(raw, chunk, validCitationIds);
        if (!parsed) throw new Error("Failed to parse OpenAI response.");
        all.push(...parsed);
      }
      items = all;
    } catch (e: any) {
      failure = e?.message ? String(e.message) : "OpenAI request failed.";
      items = null;
    }

    if (!items) {
      console.warn("Ideate failed:", failure);
      return NextResponse.json({ error: failure ?? "No ideas generated." }, { status: 500 });
    }

    return NextResponse.json({ brief, items, sources });
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : "Unknown server error.";
    console.warn("Ideate crashed:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
