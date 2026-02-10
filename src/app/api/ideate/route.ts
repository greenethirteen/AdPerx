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
  return results.slice(0, n).map((r) => ({
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
    "The Creative Angle should be human, idea-sparking, and non-obvious (not a slogan).",
    "Push it: be bold, witty, and a little wild or extreme when it helps.",
    "Keep all text very concise (aim ~8-14 words each), punchy, and useful.",
    "Avoid filler and explainers. Write like a sharp strategist.",
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
    temperature: 0.5,
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
    "Keep all text very concise (aim ~8-14 words each), non-obvious, and punchy.",
    "Avoid filler and explainers. Write like a sharp strategist.",
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
    temperature: 0.5,
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
function safeParseItems(raw: string, techniques: string[]): IdeationItem[] | null {
  try {
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
        line: String(x.line ?? ""),
        insight: String(x.insight ?? ""),
        idea: String(x.idea ?? ""),
        execution: String(x.execution ?? ""),
        pros: Array.isArray(x.pros) ? x.pros.map(String).filter(Boolean).slice(0, 3) : [],
        citations: Array.isArray(x.citations) ? x.citations.map(String) : []
      }));
    if (!normalized.length) return null;
    // Ensure full coverage order
    const map = new Map(normalized.map((i) => [i.technique, i]));
    return techniques.map((t) => map.get(t) ?? { technique: t, line: "", insight: "", idea: "", execution: "", pros: [], citations: [] });
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
        const parsed = safeParseItems(raw, chunk);
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
