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
    .map((r, idx) => ({ ...r, _rank: idx, bestLink: getBestCampaignLink(r) }))
    .filter((r) => !!r.bestLink)
    .sort((a, b) => {
      // Preserve search relevance first; use enrichment only as a tie-breaker.
      const as = Number((a as any).score ?? 0);
      const bs = Number((b as any).score ?? 0);
      if (bs !== as) return bs - as;
      const ae = a.enrichmentText ? 1 : 0;
      const be = b.enrichmentText ? 1 : 0;
      if (be !== ae) return be - ae;
      return a._rank - b._rank;
    });

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
    bestLink: r.bestLink,
    enrichment: r.enrichment ?? null,
    enrichmentText: r.enrichmentText ?? ""
  }));
}

type AskModelOutput = {
  answer: string;
  keyPoints: string[];
  sourceIds: string[];
};

type WebSource = {
  url: string;
  title: string;
  snippet: string;
};

function tokenize(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 4);
}

function unique<T>(arr: T[]) {
  return [...new Set(arr)];
}

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

async function callOpenAI(question: string, sources: ReturnType<typeof pickSources>, webSources: WebSource[]) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const validIds = new Set(sources.map((s) => s.id));

  const system = [
    "You are a senior advertising strategy analyst.",
    "Use both campaign sources and web sources.",
    "Treat campaign sources as the primary corpus for case examples and links.",
    "Use web sources to improve factual context and explanation quality.",
    "When enrichment fields are present, prefer them for factual detail.",
    "Give specific, practical analysis, not generic advice.",
    "For each recommended campaign pattern, explain: tactic, why it worked, and how to adapt it to the user's ask.",
    "Prioritize concrete mechanisms (creative device, channel choice, audience tension, execution format).",
    "If outcomes are unknown, say that explicitly instead of inventing metrics.",
    "Keep the answer concise: 70-110 words total.",
    "Keep keyPoints ultra-short: each 6-14 words, maximum 4 points.",
    "Return JSON only with shape: { answer: string, keyPoints: string[], sourceIds: string[] }.",
    "sourceIds must be ids from the provided sources."
  ].join(" ");

  const user = {
    question,
    sources,
    webSources
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
      max_tokens: 700
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

function stripHtml(html: string) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizeFoundUrl(raw: string) {
  if (!raw) return "";
  let u = raw.replace(/&amp;/g, "&");
  if (u.startsWith("//")) u = `https:${u}`;
  try {
    const parsed = new URL(u);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return parsed.toString();
  } catch {
    return "";
  }
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isBadWebTarget(url: string) {
  const h = hostOf(url);
  if (!h) return true;
  if (h.includes("duckduckgo.com") || h.includes("bing.com") || h.includes("google.com")) return true;
  if (h.includes("lovetheworkmore.com")) return true;
  return false;
}

async function searchWeb(query: string): Promise<Array<{ url: string; title: string }>> {
  const out: Array<{ url: string; title: string }> = [];
  const seen = new Set<string>();

  try {
    const ddg = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: { "user-agent": "AdPerxAskWeb/1.0" },
      cache: "no-store"
    });
    if (ddg.ok) {
      const html = await ddg.text();
      const rx = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let m;
      while ((m = rx.exec(html)) && out.length < 12) {
        const url = normalizeFoundUrl(m[1] || "");
        const title = decodeEntities((m[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
        if (!url || isBadWebTarget(url) || seen.has(url)) continue;
        seen.add(url);
        out.push({ url, title });
      }
    }
  } catch {
    // Ignore and fallback to Bing.
  }

  if (out.length < 5) {
    try {
      const bing = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}&count=10`, {
        method: "GET",
        headers: { "user-agent": "AdPerxAskWeb/1.0" },
        cache: "no-store"
      });
      if (bing.ok) {
        const html = await bing.text();
        const rx = /<li[^>]*class=(?:"|')?b_algo(?:"|')?[\s\S]*?<h2[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m;
        while ((m = rx.exec(html)) && out.length < 12) {
          const url = normalizeFoundUrl(m[1] || "");
          const title = decodeEntities((m[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
          if (!url || isBadWebTarget(url) || seen.has(url)) continue;
          seen.add(url);
          out.push({ url, title });
        }
      }
    } catch {
      // Ignore.
    }
  }

  return out;
}

function buildWebQueries(question: string, sources: ReturnType<typeof pickSources>) {
  const base = [
    `${question} advertising campaign case study`,
    `${question} campaign strategy insights`,
    `${question} creative effectiveness`
  ];
  const seeded = sources.slice(0, 3).map((s) => `${s.brand} ${s.title} campaign case study`);
  return unique([...base, ...seeded]).slice(0, 6);
}

function extractRelevantSnippet(text: string, queryTerms: string[]) {
  const normalized = stripHtml(text).slice(0, 50000);
  if (!normalized) return "";

  const chunks = normalized
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 50 && x.length <= 360);

  if (!chunks.length) return normalized.slice(0, 520);

  const scored = chunks.map((chunk) => {
    const low = chunk.toLowerCase();
    const score = queryTerms.reduce((n, t) => (low.includes(t) ? n + 1 : n), 0);
    return { chunk, score };
  });

  const ranked = scored
    .sort((a, b) => (b.score !== a.score ? b.score - a.score : b.chunk.length - a.chunk.length))
    .filter((x) => x.score > 0)
    .slice(0, 4)
    .map((x) => x.chunk);

  const picked = ranked.length ? ranked : chunks.slice(0, 3);
  return picked.join(" ").slice(0, 900);
}

async function buildWebSources(question: string, sources: ReturnType<typeof pickSources>): Promise<WebSource[]> {
  const queries = buildWebQueries(question, sources);
  const lists = await Promise.all(queries.map((q) => searchWeb(q)));
  const candidates = unique(lists.flat().map((x) => JSON.stringify(x))).map((x) => JSON.parse(x) as { url: string; title: string });
  if (!candidates.length) return [];

  const queryTerms = unique(tokenize(question)).slice(0, 12);
  const picked = candidates.slice(0, 8);
  const webSources: WebSource[] = [];

  for (const c of picked) {
    try {
      const res = await fetch(c.url, {
        method: "GET",
        headers: { "user-agent": "AdPerxAskWeb/1.0" },
        cache: "no-store"
      });
      if (!res.ok) continue;
      const html = await res.text();
      const title =
        decodeEntities(html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || "") ||
        decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "") ||
        c.title;
      const desc =
        decodeEntities(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] || "") ||
        decodeEntities(html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] || "");
      const snippet = (extractRelevantSnippet(html, queryTerms) || desc || stripHtml(html).slice(0, 520)).slice(0, 900);
      if (!snippet) continue;
      webSources.push({ url: c.url, title: title || c.title, snippet });
    } catch {
      // Ignore single-source failures.
    }
  }

  return webSources.slice(0, 6);
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

function buildFallback(question: string, sources: ReturnType<typeof pickSources>, webSources: WebSource[]) {
  const topTopics = topTerms(sources, "topics");
  const topFormats = topTerms(sources, "formatHints");
  const brands = Array.from(new Set(sources.map((s) => s.brand).filter(Boolean))).slice(0, 5);

  const keyPoints = [
    topTopics.length ? `Top recurring topics: ${topTopics.join(", ")}.` : "",
    topFormats.length ? `Frequent formats: ${topFormats.join(", ")}.` : "",
    brands.length ? `Strong matching brands: ${brands.join(", ")}.` : "",
    webSources.length ? `Live web context included from ${webSources.length} sources.` : ""
  ].filter(Boolean);

  const answer =
    `Based on your library query "${question}", I found ${sources.length} strong matching case studies. ` +
    `${webSources.length ? "I also incorporated live web context. " : ""}` +
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
    // Mandatory live web retrieval for every Ask request.
    const webSources = await buildWebSources(question, sources);
    if (!webSources.length) {
      return NextResponse.json(
        {
          error: "Live web retrieval returned no sources. Web search is required for Ask responses; please retry."
        },
        { status: 502 }
      );
    }
    if (!sources.length) {
      return NextResponse.json({
        answer: "No good matches found for this query in your current library filters.",
        keyPoints: ["Try broadening the query or clearing filters."],
        sources: [],
        webSources,
        totalMatches: search.total
      });
    }

    let modelOut: AskModelOutput | null = null;
    try {
      modelOut = await callOpenAI(question, sources, webSources);
    } catch {
      modelOut = null;
    }

    const finalOut = modelOut ?? buildFallback(question, sources, webSources);
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
      webSources,
      totalMatches: search.total
    });
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : "Ask request failed.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
