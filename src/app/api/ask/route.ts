import { NextResponse } from "next/server";
import { runSearch } from "@/lib/search";
import type { Campaign, SearchFilters } from "@/lib/types";

export const runtime = "nodejs";

type AskReq = {
  question: string;
  filters?: SearchFilters;
};

function pickSources(results: Campaign[], n = 10) {
  return results.slice(0, n).map((r) => ({
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
    thumbnailUrl: r.thumbnailUrl ?? ""
  }));
}

async function callOpenAI(question: string, sources: ReturnType<typeof pickSources>) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  const system = [
    "You are an advertising research assistant.",
    "Answer using ONLY the provided sources (campaign metadata + links).",
    "Be concise, practical, and creative-director helpful.",
    "When you reference a campaign, include (Brand — Title, Year) and attach the best link (outboundUrl if present, otherwise sourceUrl)."
  ].join(" ");

  const user = {
    question,
    sources
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(user) }
      ]
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenAI error ${res.status}: ${txt.slice(0, 400)}`);
  }
  const json = await res.json();
  const answer = json.choices?.[0]?.message?.content ?? "";
  return answer;
}

export async function POST(req: Request) {
  const body = (await req.json()) as AskReq;
  const question = (body.question ?? "").trim();
  if (!question) return NextResponse.json({ error: "Missing question" }, { status: 400 });

  const filters: SearchFilters = { ...(body.filters ?? {}), q: question };
  const search = runSearch(filters, 24);
  const sources = pickSources(search.results, 10);

  let answer: string | null = null;
  try {
    answer = await callOpenAI(question, sources);
  } catch (e: any) {
    // fall through
    answer = null;
  }

  if (!answer) {
    // Non-AI fallback: quick structured summary
    answer =
      `Here are the most relevant matches I found in your library:\n\n` +
      sources
        .map((s, i) => {
          const link = s.outboundUrl || s.sourceUrl;
          return `${i + 1}. ${s.brand} — ${s.title} (${s.year})${link ? ` → ${link}` : ""}`;
        })
        .join("\n");
  }

  return NextResponse.json({ answer, sources, totalMatches: search.total });
}
