import { NextResponse } from "next/server";
import { runSearch } from "@/lib/search";
import type { Campaign, SearchFilters } from "@/lib/types";
import { getBestCampaignLink } from "@/lib/links";

export const runtime = "nodejs";

type AskReq = {
  question: string;
  filters?: SearchFilters;
};

function pickSources(results: Campaign[], n = 18) {
  const ranked = results
    .map((r) => ({ ...r, bestLink: getBestCampaignLink(r) }))
    .filter((r) => !!r.bestLink);

  return ranked.slice(0, n).map((r) => ({
    id: r.id,
    title: r.title,
    brand: r.brand,
    agency: r.agency ?? "",
    year: r.year ?? 0,
    industry: r.industry ?? "",
    topics: r.topics ?? [],
    formatHints: r.formatHints ?? [],
    sourceUrl: r.sourceUrl ?? "",
    outboundUrl: r.outboundUrl ?? "",
    thumbnailUrl: r.thumbnailUrl ?? "",
    bestLink: r.bestLink
  }));
}

type AskModelOutput = {
  answer: string;
  keyPoints: string[];
  sourceIds: string[];
};

function parseModelOutput(raw: string, validIds: Set<string>): AskModelOutput | null {
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const slice = start !== -1 && end !== -1 ? raw.slice(start, end + 1) : raw;
    const obj = JSON.parse(slice);
    const answer = String(obj.answer ?? "").trim();
    const keyPoints = Array.isArray(obj.keyPoints)
      ? obj.keyPoints.map((x: unknown) => String(x ?? "").trim()).filter(Boolean).slice(0, 5)
      : [];
    const sourceIds = Array.isArray(obj.sourceIds)
      ? obj.sourceIds.map((x: unknown) => String(x ?? "")).filter((id: string) => validIds.has(id)).slice(0, 10)
      : [];
    if (!answer) return null;
    return { answer, keyPoints, sourceIds };
  } catch {
    return null;
  }
}

async function callOpenAI(question: string, sources: ReturnType<typeof pickSources>) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const validIds = new Set(sources.map((s) => s.id));

  const system = [
    "You are a senior advertising strategy analyst.",
    "Answer ONLY from the provided campaign sources.",
    "Be specific and practical, not generic.",
    "Return JSON only with shape: { answer: string, keyPoints: string[], sourceIds: string[] }.",
    "sourceIds must be ids from the provided sources."
  ].join(" ");

  const user = {
    question,
    sources
  };

  const tool = {
    type: "function",
    function: {
      name: "emit_answer",
      description: "Return answer, key points, and source ids.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          answer: { type: "string" },
          keyPoints: { type: "array", items: { type: "string" } },
          sourceIds: { type: "array", items: { type: "string" } }
        },
        required: ["answer", "keyPoints", "sourceIds"]
      }
    }
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      tools: [tool],
      tool_choice: { type: "function", function: { name: "emit_answer" } },
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) }
      ],
      max_tokens: 500
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = await res.json();
  const msg = json.choices?.[0]?.message;
  const args = msg?.tool_calls?.[0]?.function?.arguments;
  if (args) {
    const parsed = parseModelOutput(args, validIds);
    if (parsed) return parsed;
  }
  const content = msg?.content ?? "";
  const fallback = parseModelOutput(content, validIds);
  return fallback;
}

function topTerms(rows: ReturnType<typeof pickSources>, key: "topics" | "formatHints", take = 3) {
  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const t of r[key] ?? []) {
      const k = String(t).trim();
      if (!k) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, take)
    .map(([k]) => k);
}

function buildFallback(question: string, sources: ReturnType<typeof pickSources>) {
  const topTopics = topTerms(sources, "topics");
  const topFormats = topTerms(sources, "formatHints");
  const brands = Array.from(new Set(sources.map((s) => s.brand).filter(Boolean))).slice(0, 5);

  const keyPoints = [
    topTopics.length ? `Top recurring topics: ${topTopics.join(", ")}.` : "",
    topFormats.length ? `Frequent formats: ${topFormats.join(", ")}.` : "",
    brands.length ? `Strong matching brands: ${brands.join(", ")}.` : ""
  ].filter(Boolean);

  const answer =
    `Based on your library query "${question}", I found ${sources.length} strong matching case studies. ` +
    `Use the sources below to compare patterns, then shortlist 3-5 references by format fit and strategic similarity.`;

  return {
    answer,
    keyPoints,
    sourceIds: sources.slice(0, 8).map((s) => s.id)
  };
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AskReq;
    const question = (body.question ?? "").trim();
    if (!question) return NextResponse.json({ error: "Missing question" }, { status: 400 });

    const filters: SearchFilters = { ...(body.filters ?? {}), q: question };
    const search = runSearch(filters, 80);
    const sources = pickSources(search.results, 18);
    if (!sources.length) {
      return NextResponse.json({
        answer: "No good matches found for this query in your current library filters.",
        keyPoints: ["Try broadening the query or clearing filters."],
        sources: [],
        totalMatches: search.total
      });
    }

    let modelOut: AskModelOutput | null = null;
    try {
      modelOut = await callOpenAI(question, sources);
    } catch {
      modelOut = null;
    }

    const finalOut = modelOut ?? buildFallback(question, sources);
    const chosenSet = new Set(finalOut.sourceIds);
    const picked = sources.filter((s) => chosenSet.has(s.id));
    const ordered =
      picked.length > 0
        ? picked
        : sources.slice(0, 8);

    return NextResponse.json({
      answer: finalOut.answer,
      keyPoints: finalOut.keyPoints,
      sources: ordered.map((s) => ({
        ...s,
        bestLink: s.bestLink || getBestCampaignLink(s as Campaign)
      })),
      totalMatches: search.total
    });
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : "Ask request failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
